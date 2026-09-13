-- Exchange Stage 1: security and economy hardening.
-- Run after all existing Exchange migrations.

alter table public.credit_transactions
  add column if not exists reason text,
  add column if not exists admin_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists promotion_id uuid references public.promotions(id) on delete set null,
  add column if not exists balance_after integer;

alter table public.promotions
  drop constraint if exists promotions_status_check;

alter table public.promotions
  add constraint promotions_status_check
  check (status in ('active','paused','completed','cancelled'));

create table if not exists public.task_verifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null default 'manual' check (method in ('manual','platform','link','screenshot')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  proof_url text,
  note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(task_id,user_id)
);

alter table public.task_verifications enable row level security;

drop policy if exists "task_verifications_select_own" on public.task_verifications;
create policy "task_verifications_select_own"
on public.task_verifications for select
using (auth.uid() = user_id);

drop policy if exists "task_verifications_insert_own" on public.task_verifications;
create policy "task_verifications_insert_own"
on public.task_verifications for insert
with check (auth.uid() = user_id);

create index if not exists task_verifications_task_idx on public.task_verifications(task_id);
create index if not exists task_verifications_user_idx on public.task_verifications(user_id,created_at desc);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  target_user_id uuid references public.profiles(id) on delete set null,
  amount integer,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id,created_at desc);
create index if not exists audit_logs_target_idx on public.audit_logs(target_user_id,created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type,entity_id,created_at desc);

create or replace function public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_target_user_id uuid default null,
  p_amount integer default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id,
    target_user_id, amount, reason, metadata
  ) values (
    auth.uid(), p_action, p_entity_type, p_entity_id,
    p_target_user_id, p_amount, p_reason, coalesce(p_metadata,'{}'::jsonb)
  );
end;
$$;

revoke all on function public.write_audit_log(text,text,uuid,uuid,integer,text,jsonb) from public, anon, authenticated;

create or replace function public.exchange_valid_target_url(
  p_platform text,
  p_url text
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_url text := lower(trim(coalesce(p_url,'')));
begin
  if v_url !~ '^https://[^[:space:]]+$' then
    return false;
  end if;

  if p_platform = 'Instagram' then
    return v_url ~ '^https://(www\\.)?instagram\\.com(/|$)';
  elsif p_platform = 'TikTok' then
    return v_url ~ '^https://(www\\.)?tiktok\\.com(/|$)';
  elsif p_platform = 'YouTube' then
    return v_url ~ '^https://(www\\.)?youtube\\.com(/|$)'
       or v_url ~ '^https://youtu\\.be(/|$)';
  elsif p_platform = 'X' then
    return v_url ~ '^https://(www\\.)?(x\\.com|twitter\\.com)(/|$)';
  elsif p_platform = 'Facebook' then
    return v_url ~ '^https://(www\\.)?facebook\\.com(/|$)';
  end if;

  return false;
end;
$$;

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
  v_balance integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_cost < 10 then raise exception 'Minimum promotion budget is 10 credits'; end if;
  if p_cost > 100000 then raise exception 'Maximum promotion budget is 100000 credits'; end if;
  if p_title is null or length(trim(p_title)) < 3 then raise exception 'Promotion title is too short'; end if;
  if p_platform not in ('Instagram','TikTok','X','YouTube','Facebook') then raise exception 'Invalid platform'; end if;
  if p_action not in ('Follow','Subscribe','Like','Visit') then raise exception 'Invalid action'; end if;
  if not public.exchange_valid_target_url(p_platform,p_target_url) then raise exception 'Target URL does not match the selected platform'; end if;

  if not exists (
    select 1 from public.social_profiles
    where id=p_social_profile_id and user_id=v_user and active=true
  ) then raise exception 'Profile not found or inactive'; end if;

  v_reward := greatest(1,least(1000,floor(p_cost/10)::integer));

  select credits into v_balance
  from public.profiles
  where id=v_user
  for update;

  if v_balance is null then raise exception 'Profile not found'; end if;
  if v_balance < p_cost then raise exception 'Not enough credits'; end if;

  update public.profiles
  set credits=credits-p_cost,updated_at=now()
  where id=v_user;

  insert into public.promotions(
    user_id,social_profile_id,cost,remaining_budget,status,
    title,platform,action,reward,target_url
  ) values (
    v_user,p_social_profile_id,p_cost,p_cost,'active',
    trim(p_title),p_platform,p_action,v_reward,trim(p_target_url)
  ) returning id into v_promotion_id;

  insert into public.credit_transactions(
    user_id,amount,type,promotion_id,reason,balance_after
  ) values (
    v_user,-p_cost,'promotion_spend',v_promotion_id,
    'Promotion budget reserved',v_balance-p_cost
  );

  insert into public.tasks(
    owner_id,social_profile_id,promotion_id,platform,action,
    target_url,title,category,reward,status
  ) values (
    v_user,p_social_profile_id,v_promotion_id,p_platform,p_action,
    trim(p_target_url),trim(p_title),'Promotion',v_reward,'active'
  );

  perform public.write_audit_log(
    'promotion_created','promotion',v_promotion_id,v_user,-p_cost,
    'Promotion budget reserved',jsonb_build_object('platform',p_platform,'action',p_action)
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
  v_recent integer;
  v_daily integer;
  v_balance integer;
  v_task_url text;
  v_platform text;
  v_action text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select count(*) into v_recent
  from public.task_completions
  where user_id=v_user and completed_at > now()-interval '1 minute';
  if v_recent >= 30 then raise exception 'Too many task completions. Please try again later'; end if;

  select count(*) into v_daily
  from public.task_completions
  where user_id=v_user and completed_at > date_trunc('day',now());
  if v_daily >= 300 then raise exception 'Daily task completion limit reached'; end if;

  select owner_id,reward,promotion_id,target_url,platform,action
  into v_owner,v_reward,v_promotion,v_task_url,v_platform,v_action
  from public.tasks
  where id=p_task_id and status='active';

  if v_reward is null then raise exception 'Task not found or inactive'; end if;
  if v_owner=v_user then raise exception 'You cannot complete your own task'; end if;
  if not public.exchange_valid_target_url(v_platform,v_task_url) then raise exception 'Task target URL is invalid'; end if;

  if exists(select 1 from public.task_completions where task_id=p_task_id and user_id=v_user) then raise exception 'Task already completed'; end if;

  if v_promotion is not null then
    select remaining_budget into v_remaining
    from public.promotions
    where id=v_promotion and status='active'
    for update;

    if v_remaining is null then raise exception 'Promotion is no longer active'; end if;
    if v_remaining < v_reward then raise exception 'Promotion budget exhausted'; end if;

    update public.promotions
    set remaining_budget=remaining_budget-v_reward,
        status=case when remaining_budget-v_reward=0 then 'completed' else status end
    where id=v_promotion;
  end if;

  select credits into v_balance
  from public.profiles
  where id=v_user
  for update;

  insert into public.task_completions(task_id,user_id,reward)
  values(p_task_id,v_user,v_reward)
  returning id into v_completion;

  update public.profiles
  set credits=credits+v_reward,updated_at=now()
  where id=v_user;

  insert into public.credit_transactions(
    user_id,amount,type,task_completion_id,promotion_id,reason,balance_after
  ) values (
    v_user,v_reward,'task_reward',v_completion,v_promotion,
    'Task reward credited',v_balance+v_reward
  );

  if v_promotion is not null and v_remaining=v_reward then
    update public.tasks set status='completed' where id=p_task_id;
  end if;

  perform public.write_audit_log(
    'task_completed','task',p_task_id,v_user,v_reward,
    'Task reward credited',jsonb_build_object('promotion_id',v_promotion,'platform',v_platform,'action',v_action)
  );

  return v_reward;
end;
$$;

revoke all on function public.complete_task(uuid) from public;
grant execute on function public.complete_task(uuid) to authenticated;

drop function if exists public.cancel_promotion(uuid);
create function public.cancel_promotion(p_promotion_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_remaining integer;
  v_status text;
  v_balance integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select remaining_budget,status into v_remaining,v_status
  from public.promotions
  where id=p_promotion_id and user_id=v_user
  for update;

  if v_status is null then raise exception 'Promotion not found'; end if;
  if v_status='completed' then raise exception 'Promotion is already completed'; end if;
  if v_status='cancelled' then raise exception 'Promotion is already cancelled'; end if;

  v_remaining := greatest(0,coalesce(v_remaining,0));

  update public.promotions
  set remaining_budget=0,status='cancelled'
  where id=p_promotion_id;

  update public.tasks
  set status='completed'
  where promotion_id=p_promotion_id and status in ('active','paused');

  if v_remaining > 0 then
    select credits into v_balance from public.profiles where id=v_user for update;
    update public.profiles set credits=credits+v_remaining,updated_at=now() where id=v_user;
    insert into public.credit_transactions(
      user_id,amount,type,promotion_id,reason,balance_after
    ) values (
      v_user,v_remaining,'promotion_refund',p_promotion_id,
      'Campaign cancellation refund',v_balance+v_remaining
    );
  end if;

  perform public.write_audit_log(
    'promotion_cancelled','promotion',p_promotion_id,v_user,v_remaining,
    'Campaign cancelled and unused budget refunded',null
  );

  return v_remaining;
end;
$$;

revoke all on function public.cancel_promotion(uuid) from public;
grant execute on function public.cancel_promotion(uuid) to authenticated;

create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'Admin adjustment'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_old integer;
  v_new integer;
begin
  perform public.admin_guard();
  if p_amount=0 then raise exception 'Amount cannot be zero'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Reason is required'; end if;

  select credits into v_old from public.profiles where id=p_user_id for update;
  if v_old is null then raise exception 'User not found'; end if;
  if v_old+p_amount < 0 then raise exception 'Balance cannot become negative'; end if;

  update public.profiles
  set credits=credits+p_amount,updated_at=now()
  where id=p_user_id
  returning credits into v_new;

  insert into public.credit_transactions(
    user_id,amount,type,reason,admin_user_id,balance_after
  ) values (
    p_user_id,p_amount,'admin_adjustment',trim(p_reason),v_admin,v_new
  );

  perform public.write_audit_log(
    'credit_adjustment','profile',p_user_id,p_user_id,p_amount,trim(p_reason),
    jsonb_build_object('balance_before',v_old,'balance_after',v_new)
  );

  return v_new;
end;
$$;

revoke all on function public.admin_adjust_credits(uuid,integer,text) from public;
grant execute on function public.admin_adjust_credits(uuid,integer,text) to authenticated;

drop function if exists public.admin_delete_promotion(uuid);
create function public.admin_delete_promotion(p_promotion_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_user uuid;
  v_remaining integer;
  v_balance integer;
begin
  perform public.admin_guard();

  select user_id,greatest(0,coalesce(remaining_budget,0))
  into v_user,v_remaining
  from public.promotions
  where id=p_promotion_id
  for update;

  if v_user is null then raise exception 'Promotion not found'; end if;

  update public.promotions
  set remaining_budget=0,status='cancelled'
  where id=p_promotion_id;

  update public.tasks
  set status='completed'
  where promotion_id=p_promotion_id and status in ('active','paused');

  if v_remaining>0 then
    select credits into v_balance from public.profiles where id=v_user for update;
    update public.profiles set credits=credits+v_remaining,updated_at=now() where id=v_user;
    insert into public.credit_transactions(
      user_id,amount,type,promotion_id,reason,admin_user_id,balance_after
    ) values (
      v_user,v_remaining,'promotion_refund',p_promotion_id,
      'Admin campaign deletion refund',v_admin,v_balance+v_remaining
    );
  end if;

  perform public.write_audit_log(
    'admin_promotion_deleted','promotion',p_promotion_id,v_user,v_remaining,
    'Admin cancelled campaign and refunded unused budget',null
  );

  return v_remaining;
end;
$$;

revoke all on function public.admin_delete_promotion(uuid) from public;
grant execute on function public.admin_delete_promotion(uuid) to authenticated;

create or replace function public.credit_ledger_check(p_user_id uuid default null)
returns table(user_id uuid,profile_balance integer,ledger_net integer,difference integer)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.credits,
    coalesce(sum(ct.amount),0)::integer,
    p.credits - coalesce(sum(ct.amount),0)::integer
  from public.profiles p
  left join public.credit_transactions ct on ct.user_id=p.id
  where p_user_id is null or p.id=p_user_id
  group by p.id,p.credits
  order by p.id;
$$;

revoke all on function public.credit_ledger_check(uuid) from public;
grant execute on function public.credit_ledger_check(uuid) to authenticated;

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
  if p_method not in ('manual','platform','link','screenshot') then raise exception 'Invalid verification method'; end if;
  if not exists(select 1 from public.tasks where id=p_task_id and status='active') then raise exception 'Task not found or inactive'; end if;
  if exists(select 1 from public.task_completions where task_id=p_task_id and user_id=v_user) then raise exception 'Task already completed'; end if;

  insert into public.task_verifications(task_id,user_id,method,proof_url,note)
  values(p_task_id,v_user,p_method,nullif(trim(p_proof_url),''),nullif(trim(p_note),''))
  on conflict(task_id,user_id) do update set
    method=excluded.method,
    proof_url=excluded.proof_url,
    note=excluded.note,
    status='pending',
    reviewed_by=null,
    reviewed_at=null
  returning id into v_id;

  perform public.write_audit_log(
    'verification_submitted','task',p_task_id,v_user,null,
    'Task verification submitted',jsonb_build_object('verification_id',v_id,'method',p_method)
  );

  return v_id;
end;
$$;

revoke all on function public.submit_task_verification(uuid,text,text,text) from public;
grant execute on function public.submit_task_verification(uuid,text,text,text) to authenticated;

create or replace function public.admin_review_task_verification(
  p_verification_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_task uuid;
  v_user uuid;
begin
  perform public.admin_guard();
  if p_status not in ('approved','rejected') then raise exception 'Invalid verification status'; end if;

  select task_id,user_id into v_task,v_user
  from public.task_verifications
  where id=p_verification_id
  for update;

  if v_task is null then raise exception 'Verification not found'; end if;

  update public.task_verifications
  set status=p_status,
      note=coalesce(nullif(trim(p_note),''),note),
      reviewed_by=v_admin,
      reviewed_at=now()
  where id=p_verification_id;

  perform public.write_audit_log(
    'verification_reviewed','task',v_task,v_user,null,
    coalesce(nullif(trim(p_note),''),'Verification reviewed'),
    jsonb_build_object('verification_id',p_verification_id,'status',p_status,'reviewed_by',v_admin)
  );
end;
$$;

revoke all on function public.admin_review_task_verification(uuid,text,text) from public;
grant execute on function public.admin_review_task_verification(uuid,text,text) to authenticated;

revoke all on public.audit_logs from anon,authenticated;
