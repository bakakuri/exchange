-- 018_completion_details_view.sql
-- Added in Stage 8 (verification), once there's an API that needs both
-- "my submissions" and "submissions waiting on my review" - the same
-- underlying join (task_completions + tasks + campaigns +
-- task_verifications), filtered a different way each time. Rather than
-- have two API code paths each hand-write a three-table join (and risk
-- them drifting), this view does the join once; the two endpoints
-- differ only in which column they filter by (completer_id vs.
-- campaign_creator_id).
--
-- Same security model as 017_open_tasks_view.sql, with the same
-- required option: a plain view, no security definer, created WITH
-- (security_invoker = true) so it runs as the querying role rather than
-- as its owner. It runs as the querying role, and
-- task_completions_select_participant (014_rls.sql) - visible only to
-- the completer, the campaign creator, or an admin - still decides which
-- rows come back, exactly as it would for a direct query. review_notes
-- is included deliberately: the same RLS policy already lets a rejected
-- completer see why, through task_verifications_select_participant.
--
-- security_invoker = true is not optional here, and this view is the
-- reason the option exists in this codebase at all: every view here is
-- owned by the superuser role that runs migrations, and a view without
-- this option checks its underlying tables' RLS using the *owner's*
-- privileges - a superuser, who bypasses row security entirely. Without
-- it, this view would silently hand every authenticated user every
-- other user's submitted proof (proof_url/proof_text) and every
-- reviewer's private review_notes, regardless of the participant-only
-- RLS policy above - the exact opposite of what this view exists to do.
-- Caught by scripts/test/003_completion_details_view_test.sql, which is
-- the first local test to check a third, unrelated party against a view
-- over an RLS-restricted (not merely open-to-everyone) table; see
-- 017_open_tasks_view.sql for why the same latent bug there went
-- unnoticed until now.

create view public.completion_details
with (security_invoker = true)
as
select
  tc.id,
  tc.task_id,
  tc.user_id as completer_id,
  tc.status,
  tc.reward_amount,
  tc.created_at,
  tc.reviewed_at,
  tc.reviewed_by,
  t.campaign_id,
  t.platform,
  t.task_type,
  t.target_url,
  c.creator_id as campaign_creator_id,
  c.title as campaign_title,
  tv.proof_url,
  tv.proof_text,
  tv.submitted_at,
  tv.review_notes
from public.task_completions tc
join public.tasks t on t.id = tc.task_id
join public.campaigns c on c.id = t.campaign_id
join public.task_verifications tv on tv.completion_id = tc.id;

comment on view public.completion_details is 'task_completions enriched with its task, campaign and verification proof, for the two people who can see it: the completer and the campaign creator. RLS on task_completions decides that, exactly as it would for a direct query - this view just saves every caller from re-writing the join.';

grant select on public.completion_details to authenticated;
