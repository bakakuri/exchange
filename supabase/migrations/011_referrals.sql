-- 011_referrals.sql
-- Referral codes and the referral relationship. The reward itself is not
-- issued at signup (too easy to farm) - it is issued the first time the
-- referred user gets an approved task completion, by
-- try_reward_referral() in 015_functions.sql. This migration also
-- redefines handle_new_user() (created in 001_profiles.sql) to assign a
-- referral code on signup; the trigger from 001 keeps pointing at the
-- same function name, so no trigger changes are needed here.

alter table public.profiles
  add column referral_code text unique,
  add column referred_by uuid references public.profiles(id);

create type referral_status as enum ('pending', 'rewarded');

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null unique references public.profiles(id) on delete cascade,
  status referral_status not null default 'pending',
  reward_issued_at timestamptz,
  created_at timestamptz not null default now(),
  constraint no_self_referral check (referrer_id <> referred_id)
);

comment on table public.referrals is 'One row per referred signup. reward_issued_at is set once, by try_reward_referral(), the first time the referred user gets an approved task completion.';

create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = candidate);
  end loop;
  return candidate;
end;
$$;

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

  insert into public.profiles (id, username, referral_code)
  values (new.id, candidate, public.generate_referral_code());

  return new;
end;
$$;
