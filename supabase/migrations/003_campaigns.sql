-- 003_campaigns.sql
-- The economic container: a user spends credits to create a campaign,
-- other users complete its task (004_tasks.sql) to earn a share of its
-- budget. This table owns every economic/state-machine field; budget and
-- status are only ever changed by the SECURITY DEFINER functions in
-- 015_functions.sql, never by a direct client UPDATE (enforced by RLS in
-- 014_rls.sql).
--
-- Numbered ahead of tasks/completions/verifications (unlike the example
-- migration list) because those tables carry a foreign key to this one.

create type campaign_status as enum ('active', 'paused', 'completed', 'cancelled');

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  reward integer not null,
  desired_completions integer not null,
  completed_count integer not null default 0,
  total_budget integer generated always as (reward * desired_completions) stored,
  remaining_budget integer not null,
  status campaign_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_positive check (reward > 0),
  constraint desired_completions_positive check (desired_completions > 0),
  constraint completed_count_non_negative check (completed_count >= 0),
  constraint completed_count_within_target check (completed_count <= desired_completions),
  constraint remaining_budget_non_negative check (remaining_budget >= 0),
  constraint remaining_budget_within_total check (remaining_budget <= reward * desired_completions)
);

comment on table public.campaigns is 'Economic container created by spending credits. status/completed_count/remaining_budget are only written by functions in 015_functions.sql.';

create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();
