-- 008_notifications.sql
-- User-facing notifications. dedup_key plus the partial unique index
-- below is the duplicate-notification guard (section 26): callers pass a
-- stable key per real-world event (e.g. 'completion:<id>:approved') and a
-- second insert attempt for the same event is a no-op, not a duplicate.

create type notification_type as enum (
  'verification_approved', 'verification_rejected', 'reward_received',
  'campaign_completed', 'campaign_cancelled', 'refund',
  'achievement_unlocked', 'referral_reward', 'admin_message'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null default '',
  related_task_id uuid references public.tasks(id),
  related_campaign_id uuid references public.campaigns(id),
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is 'dedup_key + the unique index below prevents duplicate notifications for the same event.';

create unique index idx_notifications_dedup
  on public.notifications (user_id, dedup_key)
  where dedup_key is not null;
