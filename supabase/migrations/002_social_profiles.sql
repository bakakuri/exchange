-- 002_social_profiles.sql
-- Public profiles a user links from supported platforms. No third-party
-- passwords or tokens are ever stored here - public URL/username only.

create type social_platform as enum (
  'instagram', 'tiktok', 'youtube', 'facebook', 'x', 'telegram',
  'discord', 'twitch', 'reddit', 'pinterest', 'linkedin'
);

create type social_verification_state as enum ('unverified', 'pending', 'verified');

create table public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform social_platform not null,
  username text not null,
  profile_url text not null,
  display_name text,
  verification_state social_verification_state not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_profile_url_format check (profile_url ~ '^https://'),
  unique (user_id, platform, username)
);

comment on table public.social_profiles is 'Publicly linked social accounts. Never stores third-party credentials.';

create trigger trg_social_profiles_updated_at
  before update on public.social_profiles
  for each row execute function public.set_updated_at();
