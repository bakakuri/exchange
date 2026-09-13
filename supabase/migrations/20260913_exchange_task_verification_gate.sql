-- Exchange: strict task verification gate.
-- Run AFTER 20260913_exchange_api_lockdown.sql.
-- A task never pays until its verification is approved.

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
  v_completion uuid;
  v_promotion uuid;
  v_remaining integer;
  v_recent integer;
  v_daily integer;
  v_balance integer;
  v_task_url text;
  v_platform text;
  v_action text;
  v_verification_status text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into v_recent
  from public.task_completions
  where user_id = v_user
    and completed_at > now() - interval '1 minute';

  if v_recent >= 30 then
    raise exception 'Too many task completions. Please try again later';
  end if;

  select count(*) into v_daily
  from public.task_completions
  where user_id = v_user
    and completed_at > date_trunc('day', now());

  if v_daily >= 300 then
    raise exception 'Daily task completion limit reached';
  end if;

  select
    owner_id,
    reward,
    promotion_id,
    target_url,
    platform,
    action
  into
    v_owner,
    v_reward,
    v_promotion,
    v_task_url,
    v_platform,
    v_action
  from public.tasks
  where id = p_task_id
    and status = 'active'
  for update;

  if v_reward is null then
    raise exception 'Task not found or inactive';
  end if;

  if v_owner = v_user then
    raise exception 'You cannot complete your own task';
  end if;

  if not public.exchange_valid_target_url(v_platform, v_task_url) then
    raise exception 'Task target URL is invalid';
  end if;

  if exists (
    select 1
    from public.task_completions
    where task_id = p_task_id
      and user_id = v_user
  ) then
    raise exception 'Task already completed';
  end if;

  select status
  into v_verification_status
  from public.task_verifications
  where task_id = p_task_id
    and user_id = v_user
  for update;

  if v_verification_status is distinct from 'approved' then
    if v_verification_status = 'pending' then
      raise exception 'Task verification is pending';
    elsif v_verification_status = 'rejected' then
      raise exception 'Task verification was rejected';
    else
      raise exception 'Task verification is required before claiming the reward';
    end if;
  end if;

  if v_promotion is not null then
    select remaining_budget
    into v_remaining
    from public.promotions
    where id = v_promotion
      and status = 'active'
    for update;

    if v_remaining is null then
      raise exception 'Promotion is no longer active';
    end if;

    if v_remaining < v_reward then
      raise exception 'Promotion budget exhausted';
    end if;

    update public.promotions
    set
      remaining_budget = remaining_budget - v_reward,
      status = case
        when remaining_budget - v_reward = 0 then 'completed'
        else status
      end
    where id = v_promotion;
  end if;

  select credits
  into v_balance
  from public.profiles
  where id = v_user
  for update;

  if v_balance is null then
    raise exception 'Profile not found';
  end if;

  insert into public.task_completions(
    task_id,
    user_id,
    reward
  )
  values(
    p_task_id,
    v_user,
    v_reward
  )
  returning id into v_completion;

  update public.profiles
  set
    credits = credits + v_reward,
    updated_at = now()
  where id = v_user;

  insert into public.credit_transactions(
    user_id,
    amount,
    type,
    task_completion_id,
    promotion_id,
    reason,
    balance_after
  )
  values(
    v_user,
    v_reward,
    'task_reward',
    v_completion,
    v_promotion,
    'Approved task verification reward',
    v_balance + v_reward
  );

  if v_promotion is not null
     and v_remaining = v_reward then
    update public.tasks
    set status = 'completed'
    where id = p_task_id;
  end if;

  perform public.write_audit_log(
    'task_completed',
    'task',
    p_task_id,
    v_user,
    v_reward,
    'Task reward credited after approved verification',
    jsonb_build_object(
      'promotion_id', v_promotion,
      'platform', v_platform,
      'action', v_action,
      'verification_required', true
    )
  );

  return v_reward;
end;
$$;

revoke all on function public.complete_task(uuid)
from public, anon, authenticated;

grant execute on function public.complete_task(uuid)
to authenticated;

-- Admin-only queue for pending verification reviews.
create or replace function public.admin_pending_task_verifications()
returns table(
  verification_id uuid,
  task_id uuid,
  user_id uuid,
  username text,
  task_title text,
  platform text,
  action text,
  target_url text,
  method text,
  proof_url text,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();

  return query
  select
    tv.id,
    tv.task_id,
    tv.user_id,
    p.username,
    t.title,
    t.platform,
    t.action,
    t.target_url,
    tv.method,
    tv.proof_url,
    tv.note,
    tv.created_at
  from public.task_verifications tv
  join public.tasks t on t.id = tv.task_id
  left join public.profiles p on p.id = tv.user_id
  where tv.status = 'pending'
  order by tv.created_at asc;
end;
$$;

revoke all on function public.admin_pending_task_verifications()
from public, anon, authenticated;

grant execute on function public.admin_pending_task_verifications()
to authenticated;

revoke all on function public.admin_review_task_verification(uuid,text,text)
from public, anon, authenticated;

grant execute on function public.admin_review_task_verification(uuid,text,text)
to authenticated;
