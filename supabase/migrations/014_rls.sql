-- 014_rls.sql
-- Row Level Security for every table. The rule throughout: a client can
-- always read what it is entitled to see, but can only ever write the
-- handful of columns that are genuinely theirs to write directly.
-- Anything with economic or state-machine consequences (credits, XP,
-- role, campaign budget/status, verification review, achievements,
-- notifications, audit logs) has NO client-facing INSERT/UPDATE policy
-- at all - those go exclusively through the SECURITY DEFINER functions
-- in 015_functions.sql, which run with elevated privilege but still
-- check auth.uid() themselves before doing anything on a user's behalf.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------- profiles
alter table public.profiles enable row level security;
revoke all on public.profiles from authenticated, anon;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url, bio, country, language) on public.profiles to authenticated;
-- username is safe to include here: it is already fully protected by the
-- unique constraint and the username_format check in 001_profiles.sql
-- regardless of how the UPDATE arrives.

create policy profiles_select_all on public.profiles
  for select to authenticated using (true);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------- social_profiles
alter table public.social_profiles enable row level security;
revoke all on public.social_profiles from authenticated, anon;
grant select on public.social_profiles to authenticated;
grant insert (user_id, platform, username, profile_url, display_name) on public.social_profiles to authenticated;
grant update (username, profile_url, display_name) on public.social_profiles to authenticated;
grant delete on public.social_profiles to authenticated;

create policy social_profiles_select_all on public.social_profiles
  for select to authenticated using (true);

create policy social_profiles_insert_own on public.social_profiles
  for insert to authenticated with check (user_id = auth.uid());

create policy social_profiles_update_own on public.social_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy social_profiles_delete_own on public.social_profiles
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------ campaigns
alter table public.campaigns enable row level security;
revoke all on public.campaigns from authenticated, anon;
grant select on public.campaigns to authenticated;
grant update (title, description) on public.campaigns to authenticated;

create policy campaigns_select_all on public.campaigns
  for select to authenticated using (true);

create policy campaigns_update_own_presentation on public.campaigns
  for update to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

-- No INSERT policy: campaigns (and their task) are only ever created
-- together by create_campaign(), which validates and reserves the
-- creator's balance atomically.
-- No DELETE policy: campaigns are cancelled (cancel_campaign()), never
-- deleted, so financial history stays intact.

-- ---------------------------------------------------------------------- tasks
alter table public.tasks enable row level security;
revoke all on public.tasks from authenticated, anon;
grant select on public.tasks to authenticated;

create policy tasks_select_all on public.tasks
  for select to authenticated using (true);

-- ------------------------------------------------------------ task_completions
alter table public.task_completions enable row level security;
revoke all on public.task_completions from authenticated, anon;
grant select on public.task_completions to authenticated;

create policy task_completions_select_participant on public.task_completions
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      join public.campaigns c on c.id = t.campaign_id
      where t.id = task_completions.task_id and c.creator_id = auth.uid()
    )
    or public.is_admin()
  );

-- No INSERT/UPDATE policy: rows are created by submit_task_verification()
-- and transitioned by review_task_verification() only.

-- ----------------------------------------------------------- task_verifications
alter table public.task_verifications enable row level security;
revoke all on public.task_verifications from authenticated, anon;
grant select on public.task_verifications to authenticated;

create policy task_verifications_select_participant on public.task_verifications
  for select to authenticated using (
    exists (
      select 1 from public.task_completions tc
      where tc.id = task_verifications.completion_id
      and (
        tc.user_id = auth.uid()
        or exists (
          select 1 from public.tasks t
          join public.campaigns c on c.id = t.campaign_id
          where t.id = tc.task_id and c.creator_id = auth.uid()
        )
        or public.is_admin()
      )
    )
  );

-- ---------------------------------------------------------------- credit_ledger
alter table public.credit_ledger enable row level security;
revoke all on public.credit_ledger from authenticated, anon;
grant select on public.credit_ledger to authenticated;

create policy credit_ledger_select_own on public.credit_ledger
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- No INSERT/UPDATE/DELETE policy: append-only, written only by the
-- functions in 015_functions.sql (and blocked from mutation entirely by
-- the triggers in 007_credit_ledger.sql).

-- ---------------------------------------------------------------- notifications
alter table public.notifications enable row level security;
revoke all on public.notifications from authenticated, anon;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy notifications_mark_read_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- --------------------------------------------------------------------- activity
alter table public.activity enable row level security;
revoke all on public.activity from authenticated, anon;
grant select on public.activity to authenticated;

create policy activity_select_all on public.activity
  for select to authenticated using (true);

-- ---------------------------------------------------------------- achievements
alter table public.achievements enable row level security;
revoke all on public.achievements from authenticated, anon;
grant select on public.achievements to authenticated;

create policy achievements_select_all on public.achievements
  for select to authenticated using (true);

alter table public.user_achievements enable row level security;
revoke all on public.user_achievements from authenticated, anon;
grant select on public.user_achievements to authenticated;

create policy user_achievements_select_all on public.user_achievements
  for select to authenticated using (true);

-- --------------------------------------------------------------------- referrals
alter table public.referrals enable row level security;
revoke all on public.referrals from authenticated, anon;
grant select on public.referrals to authenticated;

create policy referrals_select_participant on public.referrals
  for select to authenticated using (
    referrer_id = auth.uid() or referred_id = auth.uid() or public.is_admin()
  );

-- ------------------------------------------------------------------------ reports
alter table public.reports enable row level security;
revoke all on public.reports from authenticated, anon;
grant select on public.reports to authenticated;
grant insert (report_type, description, related_task_id, related_campaign_id, related_user_id) on public.reports to authenticated;

create policy reports_select_own_or_admin on public.reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());

create policy reports_insert_own on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());

-- Resolution (status/resolved_by/resolved_at) happens only through
-- admin_resolve_report() so every decision is also audit-logged.

-- --------------------------------------------------------------------- audit_logs
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from authenticated, anon;
grant select on public.audit_logs to authenticated;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated using (public.is_admin());
