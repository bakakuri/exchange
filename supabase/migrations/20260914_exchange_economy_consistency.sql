-- Exchange economy consistency patch.
-- Restores completion guardrails while preserving Starter onboarding tasks.

create or replace function public.complete_task(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_reward integer;
  v_category text;
  v_completion uuid;
  v_promotion uuid;
  v_remaining integer;
  v_balance integer;
  v_verification_status text;
  v_target_url text;
  v_platform text;
  v_recent integer;
  v_daily integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select count(*) into v_recent from public.task_completions where user_id=v_user and completed_at > now()-interval '1 minute';
  if v_recent >= 30 then raise exception 'Too many task completions. Please try again later'; end if;
  select count(*) into v_daily from public.task_completions where user_id=v_user and completed_at > date_trunc('day',now());
  if v_daily >= 300 then raise exception 'Daily task completion limit reached'; end if;
  select owner_id,reward,category,promotion_id,target_url,platform into v_owner,v_reward,v_category,v_promotion,v_target_url,v_platform
  from public.tasks where id=p_task_id and status='active' for update;
  if v_reward is null then raise exception 'Task not found or inactive'; end if;
  if v_owner is not distinct from v_user and coalesce(v_category,'') <> 'Starter' then raise exception 'You cannot complete your own task'; end if;
  if not public.exchange_valid_target_url(v_platform,v_target_url) then raise exception 'Task target URL is invalid'; end if;
  if exists(select 1 from public.task_completions where task_id=p_task_id and user_id=v_user) then raise exception 'Task already completed'; end if;
  if v_owner is distinct from v_user then
    select status into v_verification_status from public.task_verifications where task_id=p_task_id and user_id=v_user for update;
    if v_verification_status is distinct from 'approved' then
      if v_verification_status='pending' then raise exception 'Task verification is pending';
      elsif v_verification_status='rejected' then raise exception 'Task verification was rejected';
      else raise exception 'Task verification is required before claiming the reward'; end if;
    end if;
  end if;
  if v_promotion is not null then
    select remaining_budget into v_remaining from public.promotions where id=v_promotion and status='active' for update;
    if v_remaining is null then raise exception 'Promotion is no longer active'; end if;
    if v_remaining<v_reward then raise exception 'Promotion budget exhausted'; end if;
    update public.promotions set remaining_budget=remaining_budget-v_reward,status=case when remaining_budget-v_reward=0 then 'completed' else status end where id=v_promotion;
  end if;
  select credits into v_balance from public.profiles where id=v_user for update;
  if v_balance is null then raise exception 'Profile not found'; end if;
  insert into public.task_completions(task_id,user_id,reward) values(p_task_id,v_user,v_reward) returning id into v_completion;
  update public.profiles set credits=credits+v_reward,updated_at=now() where id=v_user;
  insert into public.credit_transactions(user_id,amount,type,task_completion_id,promotion_id,reason,balance_after)
  values(v_user,v_reward,'task_reward',v_completion,v_promotion,case when v_owner is not distinct from v_user then 'Starter task reward' else 'Approved task verification reward' end,v_balance+v_reward);
  if v_promotion is not null and v_remaining=v_reward then update public.tasks set status='completed' where id=p_task_id; end if;
  perform public.write_audit_log('task_completed','task',p_task_id,v_user,v_reward,'Task reward credited',jsonb_build_object('promotion_id',v_promotion,'platform',v_platform));
  return v_reward;
end;
$$;
revoke all on function public.complete_task(uuid) from public,anon,authenticated;
grant execute on function public.complete_task(uuid) to authenticated;

create or replace function public.credit_ledger_check(p_user_id uuid default null)
returns table(user_id uuid,profile_balance integer,ledger_net integer,difference integer)
language plpgsql security definer set search_path=public
as $$
declare v_admin boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin') into v_admin;
  if not v_admin and p_user_id is distinct from auth.uid() then raise exception 'Admin access required to inspect another user ledger'; end if;
  return query select p.id,p.credits,coalesce(sum(ct.amount),0)::integer,(p.credits-coalesce(sum(ct.amount),0))::integer
  from public.profiles p left join public.credit_transactions ct on ct.user_id=p.id
  where (v_admin and (p_user_id is null or p.id=p_user_id)) or (not v_admin and p.id=auth.uid())
  group by p.id,p.credits order by p.id;
end;
$$;
revoke all on function public.credit_ledger_check(uuid) from public,anon,authenticated;
grant execute on function public.credit_ledger_check(uuid) to authenticated;

create or replace function public.admin_delete_task(p_task_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v_admin uuid:=auth.uid(); v_owner uuid; v_promotion uuid; v_remaining integer; v_balance integer;
begin
  perform public.admin_guard();
  select owner_id,promotion_id into v_owner,v_promotion from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_promotion is not null then
    select remaining_budget into v_remaining from public.promotions where id=v_promotion for update;
    if v_remaining is not null and v_remaining>0 then
      select credits into v_balance from public.profiles where id=v_owner for update;
      if v_balance is null then raise exception 'Task owner profile not found'; end if;
      update public.profiles set credits=credits+v_remaining,updated_at=now() where id=v_owner;
      insert into public.credit_transactions(user_id,amount,type,promotion_id,reason,admin_user_id,balance_after)
      values(v_owner,v_remaining,'promotion_refund',v_promotion,'Admin task deletion refund',v_admin,v_balance+v_remaining);
    end if;
    update public.promotions set remaining_budget=0,status='cancelled' where id=v_promotion;
    perform public.write_audit_log('task_deleted','task',p_task_id,v_owner,v_remaining,'Admin deleted promotion-backed task and refunded unused budget',jsonb_build_object('promotion_id',v_promotion,'admin_user_id',v_admin));
  else
    perform public.write_audit_log('task_deleted','task',p_task_id,v_owner,null,'Admin deleted task',jsonb_build_object('admin_user_id',v_admin));
  end if;
  delete from public.tasks where id=p_task_id;
end;
$$;
revoke all on function public.admin_delete_task(uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_task(uuid) to authenticated;
