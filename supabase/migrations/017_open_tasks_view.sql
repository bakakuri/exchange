-- 017_open_tasks_view.sql
-- Added in Stage 7 (task browsing), once there's an API that actually
-- needs to list "tasks a user can complete right now".
--
-- A task is open exactly when its campaign can still pay it out: active,
-- under its completion target, and with enough remaining_budget for one
-- more reward. That's three columns on the *campaign*, not the task, so
-- expressing it as a view here - instead of re-deriving it by hand in
-- every API caller, or worse letting it drift between the frontend and
-- the backend - keeps "is this task open" defined in exactly one place.
--
-- This is a plain view (no security definer) with security_invoker =
-- true, so it carries no privilege of its own: it runs as whichever role
-- queries it, and the existing RLS policies on tasks and campaigns
-- (014_rls.sql) still apply exactly as if the join were written out by
-- hand. Completing a task still goes through submit_task_verification(),
-- which re-checks all of this itself rather than trusting a row this
-- view returned moments earlier - the view is a read convenience, never
-- an authority.
--
-- security_invoker = true is not decorative here. A plain Postgres view
-- (the default, security_invoker = false) checks access to its
-- underlying tables - RLS included - using the *view owner's*
-- privileges, not the querying role's. Every view in this schema is
-- created by the migration-running role, i.e. the Postgres superuser,
-- and superusers bypass row security entirely (rolbypassrls). Without
-- this option, every query through this view would run with RLS fully
-- bypassed, for every caller, regardless of which comment above claims
-- "RLS still applies" - a comment the code would have been silently
-- lying about. It happened not to matter for tasks/campaigns, since
-- tasks_select_all and campaigns_select_all (014_rls.sql) already allow
-- `using (true)` for any authenticated user - there was no restriction
-- left to bypass. It matters a great deal for public.completion_details
-- (018_completion_details_view.sql), whose whole purpose is to enforce a
-- participant-only restriction - see that file for how this was caught.

create view public.open_tasks
with (security_invoker = true)
as
select
  t.id,
  t.campaign_id,
  t.platform,
  t.task_type,
  t.target_url,
  t.instructions,
  t.verification_method,
  t.created_at,
  c.creator_id,
  c.title as campaign_title,
  c.description as campaign_description,
  c.reward,
  c.desired_completions,
  c.completed_count,
  c.remaining_budget
from public.tasks t
join public.campaigns c on c.id = t.campaign_id
where c.status = 'active'
  and c.completed_count < c.desired_completions
  and c.remaining_budget >= c.reward;

comment on view public.open_tasks is 'Tasks whose campaign can still pay them out right now. Read-only browse convenience - submit_task_verification() re-validates everything independently and is the actual authority on whether a task can be completed.';

grant select on public.open_tasks to authenticated;
