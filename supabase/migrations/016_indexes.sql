-- 016_indexes.sql
-- Indexes for foreign keys and the query patterns the API actually uses
-- (browsing active campaigns, a user's own history, admin queues).
-- Constraints already created their own indexes (primary keys, the
-- unique(task_id, user_id) duplicate guard, unique(campaign_id) on
-- tasks, unique(completion_id) on task_verifications) and are not
-- repeated here.

create index idx_campaigns_creator on public.campaigns (creator_id);
create index idx_campaigns_status on public.campaigns (status);

create index idx_task_completions_user on public.task_completions (user_id);

create index idx_credit_ledger_user_created on public.credit_ledger (user_id, created_at desc);

create index idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index idx_notifications_unread on public.notifications (user_id) where read_at is null;

create index idx_activity_user_created on public.activity (user_id, created_at desc);

create index idx_social_profiles_user on public.social_profiles (user_id);

create index idx_referrals_referrer on public.referrals (referrer_id);

create index idx_reports_status on public.reports (status);

create index idx_audit_logs_target on public.audit_logs (target_type, target_id);
create index idx_audit_logs_created on public.audit_logs (created_at desc);
