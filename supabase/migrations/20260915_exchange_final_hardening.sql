-- Exchange final production hardening.
-- Apply after all existing Exchange migrations.

-- 1) A normal authenticated user may create only a pending verification.
-- The review path is admin-only and complete_task requires approved status.
drop policy if exists "task_verifications_insert_own" on public.task_verifications;
create policy "task_verifications_insert_own"
on public.task_verifications
for insert
with check (
  auth.uid() = user_id
  and status = 'pending'
);

-- 2) Make verification submission server-authoritative.
-- Re-create the function so callers cannot choose an approved/rejected state.
create or replace function public.submit_task_verification(
  p_task_id uuid,
  p_method text default 'manual',
  p_proof_url text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_method not in ('manual','platform','link','screenshot') then
    raise exception 'Invalid verification method';
  end if;
  if not exists (
    select 1 from public.tasks
    where id = p_task_id and status = 'active'
      and owner_id is distinct from v_user
  ) then
    raise exception 'Task not found, inactive, or owned by you';
  end if;

  insert into public.task_verifications(task_id,user_id,method,status,proof_url,note)
  values (
    p_task_id,
    v_user,
    p_method,
    'pending',
    nullif(trim(p_proof_url),''),
    nullif(trim(p_note),'')
  )
  on conflict (task_id,user_id) do update
    set method=excluded.method,
        status='pending',
        proof_url=excluded.proof_url,
        note=excluded.note,
        reviewed_by=null,
        reviewed_at=null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_task_verification(uuid,text,text,text) from public, anon;
grant execute on function public.submit_task_verification(uuid,text,text,text) to authenticated;

-- 3) Admin promotion status is now an economy-safe state machine.
-- Active/paused keep the reserved budget. Completion is only valid when the
-- budget is exhausted. Cancellation must use the refunding cancel RPC.
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
  v_status text;
  v_remaining integer;
begin
  perform public.admin_guard();

  if p_status not in ('active','paused','completed','cancelled') then
    raise exception 'Invalid promotion status';
  end if;

  select status, remaining_budget
    into v_status, v_remaining
  from public.promotions
  where id = p_promotion_id
  for update;

  if v_status is null then raise exception 'Promotion not found'; end if;

  if p_status = 'completed' and coalesce(v_remaining,0) <> 0 then
    raise exception 'Promotion cannot be completed while budget remains';
  end if;

  if p_status = 'cancelled' then
    if v_status = 'cancelled' then return; end if;
    perform public.cancel_promotion(p_promotion_id);
    return;
  end if;

  if p_status = 'active' and coalesce(v_remaining,0) <= 0 then
    raise exception 'Promotion has no remaining budget';
  end if;

  update public.promotions
  set status = p_status
  where id = p_promotion_id;

  update public.tasks
  set status = p_status
  where promotion_id = p_promotion_id
    and status <> 'completed';

  perform public.write_audit_log(
    'admin_promotion_status_changed',
    'promotion',
    p_promotion_id,
    null,
    null,
    'Admin changed promotion status',
    jsonb_build_object('from',v_status,'to',p_status,'remaining_budget',v_remaining)
  );
end;
$$;

-- 4) Admin task status cannot fabricate a completed promotion task.
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
  v_old text;
  v_promotion uuid;
  v_remaining integer;
begin
  perform public.admin_guard();
  if p_status not in ('active','paused','completed') then
    raise exception 'Invalid task status';
  end if;

  select status,promotion_id into v_old,v_promotion
  from public.tasks where id=p_task_id for update;
  if v_old is null then raise exception 'Task not found'; end if;

  if p_status='completed' and v_promotion is not null then
    select remaining_budget into v_remaining
    from public.promotions where id=v_promotion for update;
    if v_remaining is null then raise exception 'Promotion not found'; end if;
    if v_remaining > 0 then
      raise exception 'Promotion task completion must go through complete_task';
    end if;
  end if;

  update public.tasks set status=p_status where id=p_task_id;
  perform public.write_audit_log(
    'admin_task_status_changed','task',p_task_id,null,null,
    'Admin changed task status',jsonb_build_object('from',v_old,'to',p_status)
  );
end;
$$;

-- 5) Prevent the last admin from accidentally removing all admin access.
create or replace function public.admin_update_user(
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_role text;
  v_admin_count integer;
begin
  perform public.admin_guard();
  if p_role not in ('user','admin') then raise exception 'Invalid role'; end if;
  if p_username is null or length(trim(p_username)) < 3 then raise exception 'Username is too short'; end if;

  select role into v_old_role from public.profiles where id=p_user_id for update;
  if v_old_role is null then raise exception 'User not found'; end if;

  if v_old_role='admin' and p_role='user' then
    select count(*) into v_admin_count from public.profiles where role='admin';
    if v_admin_count <= 1 then
      raise exception 'Cannot remove the last administrator';
    end if;
  end if;

  update public.profiles
  set username=trim(p_username),
      display_name=coalesce(nullif(trim(p_display_name),''),trim(p_username)),
      role=p_role,
      updated_at=now()
  where id=p_user_id;

  perform public.write_audit_log(
    'admin_user_role_changed','profile',p_user_id,p_user_id,null,
    'Administrator changed user role',jsonb_build_object('from',v_old_role,'to',p_role)
  );
end;
$$;

revoke all on function public.admin_set_promotion_status(uuid,text) from public;
revoke all on function public.admin_set_task_status(uuid,text) from public;
revoke all on function public.admin_update_user(uuid,text,text,text) from public;
grant execute on function public.admin_set_promotion_status(uuid,text) to authenticated;
grant execute on function public.admin_set_task_status(uuid,text) to authenticated;
grant execute on function public.admin_update_user(uuid,text,text,text) to authenticated;

-- 6) Useful indexes for the final verification/rate-limit paths.
create index if not exists task_completions_user_completed_idx
  on public.task_completions(user_id, completed_at desc);
create index if not exists task_verifications_pending_idx
  on public.task_verifications(created_at desc)
  where status='pending';
