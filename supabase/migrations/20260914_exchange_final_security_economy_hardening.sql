-- Exchange final security/economy hardening.
-- Closes client-controlled verification status and prevents admin state changes
-- from bypassing promotion budget accounting.

-- Users may create only pending verification requests. Review status is admin-only.
drop policy if exists "task_verifications_insert_own" on public.task_verifications;
create policy "task_verifications_insert_own"
on public.task_verifications
for insert
to authenticated
with check (
  auth.uid() = user_id
  and status = 'pending'
  and method in ('manual','platform','link','screenshot')
);

-- Existing rows are preserved. Prevent ordinary clients from changing review fields.
drop policy if exists "task_verifications_update_own" on public.task_verifications;

-- Only admins may update verification rows. The RPC below remains the canonical path.
create policy "task_verifications_admin_update"
on public.task_verifications
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
  and status in ('pending','approved','rejected')
);

-- Admin task-status changes must not silently consume or strand promotion budget.
create or replace function public.admin_set_task_status(
  p_task_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_owner uuid;
  v_promotion uuid;
  v_old_status text;
  v_remaining integer;
  v_balance integer;
begin
  perform public.admin_guard();

  if p_status not in ('active','paused','completed') then
    raise exception 'Invalid task status';
  end if;

  select owner_id,promotion_id,status
  into v_owner,v_promotion,v_old_status
  from public.tasks
  where id=p_task_id
  for update;

  if v_owner is null then raise exception 'Task not found'; end if;

  -- A promoted task can only become completed through its promotion budget
  -- reaching zero. This keeps task state and money state consistent.
  if v_promotion is not null and p_status='completed' then
    select remaining_budget
    into v_remaining
    from public.promotions
    where id=v_promotion
    for update;

    if v_remaining is null then raise exception 'Promotion not found'; end if;
    if v_remaining > 0 then
      raise exception 'Cannot manually complete a promoted task while budget remains';
    end if;
  end if;

  update public.tasks set status=p_status where id=p_task_id;

  perform public.write_audit_log(
    'admin_task_status_changed','task',p_task_id,v_owner,null,
    'Admin changed task status',
    jsonb_build_object('old_status',v_old_status,'new_status',p_status,'admin_user_id',v_admin)
  );
end;
$$;

revoke all on function public.admin_set_task_status(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_set_task_status(uuid,text) to authenticated;

-- Admin promotion status changes are constrained by remaining budget.
create or replace function public.admin_set_promotion_status(
  p_promotion_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_user uuid;
  v_old_status text;
  v_remaining integer;
begin
  perform public.admin_guard();

  if p_status not in ('active','paused','completed') then
    raise exception 'Invalid promotion status';
  end if;

  select user_id,status,greatest(0,coalesce(remaining_budget,0))
  into v_user,v_old_status,v_remaining
  from public.promotions
  where id=p_promotion_id
  for update;

  if v_user is null then raise exception 'Promotion not found'; end if;

  if p_status='completed' and v_remaining > 0 then
    raise exception 'Cannot complete a promotion while budget remains';
  end if;

  update public.promotions
  set status=p_status
  where id=p_promotion_id;

  -- Pausing a promotion pauses its generated tasks. Reactivating does the reverse.
  update public.tasks
  set status=p_status
  where promotion_id=p_promotion_id
    and (p_status in ('active','paused'));

  perform public.write_audit_log(
    'admin_promotion_status_changed','promotion',p_promotion_id,v_user,null,
    'Admin changed promotion status',
    jsonb_build_object('old_status',v_old_status,'new_status',p_status,'remaining_budget',v_remaining,'admin_user_id',v_admin)
  );
end;
$$;

revoke all on function public.admin_set_promotion_status(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_set_promotion_status(uuid,text) to authenticated;

-- Ensure duplicate completion can never exist even if application logic regresses.
create unique index if not exists task_completions_task_user_uidx
on public.task_completions(task_id,user_id);

-- Verification queue remains readable only by the submitter through existing RLS;
-- admin review is performed through the protected RPC.
