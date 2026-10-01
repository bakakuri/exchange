-- 010_achievements.sql
-- Achievement definitions plus per-user unlocks. Unlocks are only ever
-- inserted by the check_achievements() function (015_functions.sql)
-- after a real database event - never awarded directly by a client.

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text not null,
  created_at timestamptz not null default now()
);

comment on table public.achievements is 'Static catalog of achievement definitions.';

create table public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);

comment on table public.user_achievements is 'One row per unlock. Only written by check_achievements() based on real events.';

insert into public.achievements (code, title, description) values
  ('first_task', 'First Task', 'Complete your first task'),
  ('tasks_10', '10 Tasks', 'Complete 10 tasks'),
  ('tasks_50', '50 Tasks', 'Complete 50 tasks'),
  ('tasks_100', '100 Tasks', 'Complete 100 tasks'),
  ('first_campaign', 'First Campaign', 'Create your first campaign'),
  ('campaigns_10', '10 Campaigns', 'Create 10 campaigns'),
  ('credits_1000', 'Credit Milestone: 1,000', 'Earn 1,000 credits in total'),
  ('credits_10000', 'Credit Milestone: 10,000', 'Earn 10,000 credits in total'),
  ('trusted_contributor', 'Trusted Contributor', 'Reach 50 approved task completions with zero rejections');
