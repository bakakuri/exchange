-- 009_activity.sql
-- A user-facing feed of what happened, separate from the financial
-- ledger (007). The ledger is the audit-grade money trail; activity is
-- for display (profile timelines, dashboards).

create type activity_type as enum (
  'task_completed', 'reward_earned', 'campaign_created',
  'campaign_completed', 'verification_submitted', 'verification_reviewed',
  'achievement_unlocked', 'referral_joined'
);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type activity_type not null,
  related_task_id uuid references public.tasks(id),
  related_campaign_id uuid references public.campaigns(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity is 'Display feed of user events. Never used as a source of truth for credits - that is credit_ledger.';
