-- 001_profiles.sql
-- Core user profile: one row per authenticated user, keyed to auth.users.
-- credits/xp/level are cached values that must only ever be written by
-- SECURITY DEFINER functions defined in 015_functions.sql - never by a
-- direct client UPDATE. RLS (014_rls.sql) enforces that separately.

create type user_role as enum ('user', 'admin');
create type user_status as enum ('active', 'suspended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  bio text,
  country text,
  language text,
  role user_role not null default 'user',
  status user_status not null default 'active',
  xp integer not null default 0,
  level integer not null default 1,
  credits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  constraint xp_non_negative check (xp >= 0),
  constraint level_at_least_one check (level >= 1),
  constraint credits_non_negative check (credits >= 0)
);

comment on table public.profiles is 'One row per authenticated user. credits/xp/level are cached and only ever written by SECURITY DEFINER functions.';
comment on column public.profiles.credits is 'Cached balance. Source of truth is the sum of credit_ledger entries for this user; kept in sync by the same functions that insert ledger rows.';

-- Generic updated_at maintenance, reused by every table with an
-- updated_at column across later migrations.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a new auth user signs up. Redefined in
-- 011_referrals.sql to also assign a referral code once that concept
-- exists; the trigger below keeps pointing at the same function name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  candidate text;
  suffix int := 0;
begin
  base_username := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  if base_username is null or length(base_username) < 3 then
    base_username := 'user';
  end if;
  base_username := left(base_username, 24);
  candidate := base_username;

  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_username, 24) || suffix::text;
  end loop;

  insert into public.profiles (id, username)
  values (new.id, candidate);

  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
