-- Exchange production-ready starter schema
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  credits integer not null default 100 check (credits >= 0),
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('Instagram','TikTok','X','YouTube','Facebook')),
  handle text not null,
  url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  social_profile_id uuid references public.social_profiles(id) on delete set null,
  platform text not null check (platform in ('Instagram','TikTok','X','YouTube','Facebook')),
  action text not null check (action in ('Follow','Subscribe','Like','Visit')),
  target_url text not null,
  title text not null,
  category text not null default 'Community',
  reward integer not null check (reward > 0 and reward <= 1000),
  status text not null default 'active' check (status in ('active','paused','completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward integer not null check (reward > 0),
  completed_at timestamptz not null default now(),
  unique(task_id, user_id)
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  type text not null check (type in ('signup_bonus','task_reward','promotion_spend','admin_adjustment')),
  task_completion_id uuid references public.task_completions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  social_profile_id uuid not null references public.social_profiles(id) on delete cascade,
  cost integer not null check (cost > 0),
  status text not null default 'active' check (status in ('active','paused','completed')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.social_profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_completions enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.promotions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "social_select_own" on public.social_profiles;
create policy "social_select_own" on public.social_profiles
for select using (auth.uid() = user_id);

drop policy if exists "social_insert_own" on public.social_profiles;
create policy "social_insert_own" on public.social_profiles
for insert with check (auth.uid() = user_id);

drop policy if exists "social_update_own" on public.social_profiles;
create policy "social_update_own" on public.social_profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "social_delete_own" on public.social_profiles;
create policy "social_delete_own" on public.social_profiles
for delete using (auth.uid() = user_id);

drop policy if exists "tasks_public_read" on public.tasks;
create policy "tasks_public_read" on public.tasks
for select using (status = 'active');

drop policy if exists "tasks_insert_own" on public.tasks;
create policy "tasks_insert_own" on public.tasks
for insert with check (auth.uid() = owner_id);

drop policy if exists "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "completions_select_own" on public.task_completions;
create policy "completions_select_own" on public.task_completions
for select using (auth.uid() = user_id);

drop policy if exists "transactions_select_own" on public.credit_transactions;
create policy "transactions_select_own" on public.credit_transactions
for select using (auth.uid() = user_id);

drop policy if exists "promotions_select_own" on public.promotions;
create policy "promotions_select_own" on public.promotions
for select using (auth.uid() = user_id);

drop policy if exists "promotions_insert_own" on public.promotions;
create policy "promotions_insert_own" on public.promotions
for insert with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, credits)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    100
  )
  on conflict (id) do nothing;

  insert into public.credit_transactions (user_id, amount, type)
  values (new.id, 100, 'signup_bonus');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.complete_task(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reward integer;
  v_completion uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select reward into v_reward
  from public.tasks
  where id = p_task_id and status = 'active';

  if v_reward is null then
    raise exception 'Task not found or inactive';
  end if;

  if exists (
    select 1 from public.task_completions
    where task_id = p_task_id and user_id = v_user
  ) then
    raise exception 'Task already completed';
  end if;

  insert into public.task_completions(task_id, user_id, reward)
  values (p_task_id, v_user, v_reward)
  returning id into v_completion;

  update public.profiles
  set credits = credits + v_reward, updated_at = now()
  where id = v_user;

  insert into public.credit_transactions(user_id, amount, type, task_completion_id)
  values (v_user, v_reward, 'task_reward', v_completion);

  return v_reward;
end;
$$;

revoke all on function public.complete_task(uuid) from public;
grant execute on function public.complete_task(uuid) to authenticated;

-- Starter public tasks. Replace target URLs with real destinations.
insert into public.tasks(owner_id, platform, action, target_url, title, category, reward)
select id, 'Instagram', 'Follow', 'https://www.instagram.com/', 'Follow a community creator', 'Creator', 8
from public.profiles
order by created_at
limit 1
on conflict do nothing;
