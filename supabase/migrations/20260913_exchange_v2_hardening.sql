-- Exchange v2 hardening migration
-- Run in Supabase SQL Editor after the Exchange v2 update.
-- This prevents promotion budgets from being exceeded and prevents users
-- from completing their own promotion tasks.

alter table public.promotions
  add column if not exists remaining_budget integer;

alter table public.tasks
  add column if not exists promotion_id uuid references public.promotions(id) on delete set null;

update public.promotions
set remaining_budget = cost
where remaining_budget is null;

alter table public.promotions
  drop constraint if exists promotions_remaining_budget_check;

alter table public.promotions
  add constraint promotions_remaining_budget_check
  check (remaining_budget >= 0 and remaining_budget <= cost);

create index if not exists tasks_promotion_idx
on public.tasks(promotion_id);

create or replace function public.create_promotion(
  p_social_profile_id uuid,
  p_title text,
  p_platform text,
  p_action text,
  p_target_url text,
  p_cost integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_promotion_id uuid;
  v_reward integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_cost < 10 then raise exception 'Minimum promotion budget is 10 credits'; end if;
  if p_cost > 100000 then raise exception 'Maximum promotion budget is 100000 credits'; end if;
  if p_title is null or length(trim(p_title)) < 3 then raise exception 'Promotion title is too short'; end if;
  if p_target_url is null or p_target_url !~ '^https?://' then raise exception 'Invalid target URL'; end if;
  if p_platform not in ('Instagram','TikTok','X','YouTube','Facebook') then raise exception 'Invalid platform'; end if;
  if p_action not in ('Follow','Subscribe','Like','Visit') then raise exception 'Invalid action'; end if;
  if not exists (
    select 1 from public.social_profiles
    where id = p_social_profile_id and user_id = v_user and active = true
  ) then raise exception 'Profile not found or inactive'; end if;

  v_reward := greatest(1, least(1000, floor(p_cost / 10)::integer));
  if v_reward > p_cost then raise exception 'Promotion budget is too small'; end if;

  update public.profiles
  set credits = credits - p_cost, updated_at = now()
  where id = v_user and credits >= p_cost;
  if not found then raise exception 'Not enough credits'; end if;

  insert into public.promotions (
    user_id, social_profile_id, cost, remaining_budget, status,
    title, platform, action, reward, target_url
  )
  values (
    v_user, p_social_profile_id, p_cost, p_cost, 'active',
    trim(p_title), p_platform, p_action, v_reward, p_target_url
  )
  returning id into v_promotion_id;

  insert into public.credit_transactions(user_id, amount, type)
  values(v_user, -p_cost, 'promotion_spend');

  insert into public.tasks (
    owner_id, social_profile_id, promotion_id, platform, action,
    target_url, title, category, reward, status
  )
  values (
    v_user, p_social_profile_id, v_promotion_id, p_platform, p_action,
    p_target_url, trim(p_title), 'Promotion', v_reward, 'active'
  );

  return v_promotion_id;
end;
$$;

revoke all on function public.create_promotion(uuid,text,text,text,text,integer) from public;
grant execute on function public.create_promotion(uuid,text,text,text,text,integer) to authenticated;

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
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select owner_id, reward, promotion_id
  into v_owner, v_reward, v_promotion
  from public.tasks
  where id = p_task_id and status = 'active';

  if v_reward is null then raise exception 'Task not found or inactive'; end if;
  if v_owner = v_user then raise exception 'You cannot complete your own task'; end if;

  if exists (
    select 1 from public.task_completions
    where task_id = p_task_id and user_id = v_user
  ) then raise exception 'Task already completed'; end if;

  if v_promotion is not null then
    select remaining_budget into v_remaining
    from public.promotions
    where id = v_promotion and status = 'active'
    for update;

    if v_remaining is null then raise exception 'Promotion is no longer active'; end if;
    if v_remaining < v_reward then raise exception 'Promotion budget exhausted'; end if;

    update public.promotions
    set remaining_budget = remaining_budget - v_reward,
        status = case when remaining_budget - v_reward = 0 then 'completed' else status end
    where id = v_promotion;
  end if;

  insert into public.task_completions(task_id, user_id, reward)
  values(p_task_id, v_user, v_reward)
  returning id into v_completion;

  update public.profiles
  set credits = credits + v_reward, updated_at = now()
  where id = v_user;

  insert into public.credit_transactions(user_id, amount, type, task_completion_id)
  values(v_user, v_reward, 'task_reward', v_completion);

  if v_promotion is not null and v_remaining = v_reward then
    update public.tasks set status = 'completed' where id = p_task_id;
  end if;

  return v_reward;
end;
$$;

revoke all on function public.complete_task(uuid) from public;
grant execute on function public.complete_task(uuid) to authenticated;
