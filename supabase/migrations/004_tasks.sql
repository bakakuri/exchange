-- 004_tasks.sql
-- The completable action that belongs to a campaign: what platform, what
-- kind of action, which URL, how to do it, how it gets verified. All
-- economic fields (reward, budget, status) live on the parent campaign,
-- not here, so there is exactly one place that can go out of sync-proof
-- for money: campaigns. A task's own availability is derived from its
-- campaign (status = 'active' and remaining_budget > 0), never stored
-- redundantly here.
--
-- v1 creates exactly one task per campaign (enforced by the unique
-- constraint below); the schema does not otherwise assume that.

create type task_platform as enum (
  'instagram', 'tiktok', 'youtube', 'facebook', 'x', 'telegram',
  'discord', 'twitch', 'reddit', 'pinterest', 'linkedin', 'other'
);

create type task_type as enum (
  'follow', 'like', 'comment', 'subscribe', 'share', 'repost',
  'save', 'join', 'visit', 'view', 'listen', 'custom'
);

create type verification_method as enum ('manual_proof', 'link_click');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns(id) on delete cascade,
  platform task_platform not null,
  task_type task_type not null,
  target_url text not null,
  instructions text not null default '',
  verification_method verification_method not null default 'manual_proof',
  created_at timestamptz not null default now(),
  constraint target_url_format check (target_url ~ '^https?://')
);

comment on table public.tasks is 'The action definition for a campaign. Availability is derived from the parent campaign, never duplicated here.';
