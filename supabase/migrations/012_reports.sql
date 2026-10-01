-- 012_reports.sql
-- User-submitted moderation reports and their admin resolution.

create type report_type as enum (
  'spam', 'fraud', 'invalid_task', 'inappropriate_content', 'broken_url', 'abuse'
);

create type report_status as enum ('open', 'resolved', 'dismissed');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  report_type report_type not null,
  description text not null default '',
  related_task_id uuid references public.tasks(id),
  related_campaign_id uuid references public.campaigns(id),
  related_user_id uuid references public.profiles(id),
  status report_status not null default 'open',
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.reports is 'User-submitted moderation reports. resolved_by/resolved_at are set by admin resolve/dismiss actions.';
