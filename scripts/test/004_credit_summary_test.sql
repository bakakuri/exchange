-- 004_credit_summary_test.sql
-- Validates public.get_credit_summary() (019_credit_summary_function.sql):
-- per-transaction-type totals for the caller's own ledger rows, and -
-- the property that actually matters here - that an admin calling it
-- gets their own summary, not the whole platform's, even though
-- credit_ledger_select_own (014_rls.sql) would let an admin SELECT
-- every user's rows directly.

\set ON_ERROR_STOP on

create temporary table if not exists test_state (key text primary key, value text);

create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000300', 'ivy-admin@example.com'),
  ('00000000-0000-0000-0000-000000000301', 'jack@example.com'),   -- campaign creator
  ('00000000-0000-0000-0000-000000000302', 'kim@example.com');    -- completer

update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000300';

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000300', false);
select public.admin_credit_adjustment('00000000-0000-0000-0000-000000000301', 500, 'seed for credit summary test');

-- jack creates a campaign: reward 10 x 3 completions = 30 reserved.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000301', false);
select test_set('campaign_id', public.create_campaign(
  'Summary test campaign', '', 'instagram', 'follow', 'https://instagram.com/summarytest', '', 'manual_proof', 10, 3
)::text);
select test_set('task_id', id::text) from public.tasks where campaign_id = test_get('campaign_id')::uuid;

-- kim completes it and jack approves - kim earns a task_reward.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000302', false);
-- a follow task needs the doer's linked account (021)
insert into public.social_profiles (user_id, platform, username, profile_url)
values ('00000000-0000-0000-0000-000000000302', 'instagram', 'kim', 'https://instagram.com/kim');
select test_set('completion_id', public.submit_task_verification(test_get('task_id')::uuid, null, 'proof', null,
  (select id from public.social_profiles where user_id = auth.uid() and platform = 'instagram'))::text);

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000301', false);
select public.review_task_verification(test_get('completion_id')::uuid, 'approved', null);

-- ---------------------------------------------------------- assertions
grant select on test_state to authenticated;
grant execute on function test_get(text) to authenticated;
set role authenticated;

-- jack: +500 admin_adjustment, -30 campaign_reservation.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000301', false);
do $$
declare
  v_admin_row record;
  v_reservation_row record;
begin
  select * into v_admin_row from public.get_credit_summary() where type = 'admin_adjustment';
  if not found or v_admin_row.total_amount <> 500 or v_admin_row.entry_count <> 1 then
    raise exception 'FAIL: jack''s admin_adjustment total should be 500 across 1 entry';
  end if;

  select * into v_reservation_row from public.get_credit_summary() where type = 'campaign_reservation';
  if not found or v_reservation_row.total_amount <> -30 or v_reservation_row.entry_count <> 1 then
    raise exception 'FAIL: jack''s campaign_reservation total should be -30 across 1 entry';
  end if;

  raise notice 'PASS: get_credit_summary totals and counts match jack''s actual ledger activity';
end $$;

-- kim: +10 task_reward, and nothing else (no admin_adjustment row for her).
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000302', false);
do $$
declare
  v_row record;
  v_row_count integer;
begin
  select * into v_row from public.get_credit_summary() where type = 'task_reward';
  if not found or v_row.total_amount <> 10 or v_row.entry_count <> 1 then
    raise exception 'FAIL: kim''s task_reward total should be 10 across 1 entry';
  end if;

  select count(*) into v_row_count from public.get_credit_summary();
  if v_row_count <> 1 then
    raise exception 'FAIL: kim should have exactly one summary row (task_reward only), got %', v_row_count;
  end if;

  raise notice 'PASS: get_credit_summary reflects only the caller''s own activity, nothing extra';
end $$;

-- The property this function exists to get right: ivy is an admin, so
-- credit_ledger_select_own would let her SELECT every user's rows
-- directly - but she has no ledger entries of her own, so her summary
-- must come back empty, not a platform-wide aggregate of jack's and
-- kim's activity.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000300', false);
do $$
declare
  v_row_count integer;
begin
  select count(*) into v_row_count from public.get_credit_summary();
  if v_row_count <> 0 then
    raise exception 'FAIL: an admin with no ledger entries of their own should get an empty summary, not everyone else''s (got % rows)', v_row_count;
  end if;
  raise notice 'PASS: an admin''s summary is their own activity only, not a platform-wide aggregate via credit_ledger_select_own';
end $$;

reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.get_credit_summary()', 'EXECUTE') then
    raise exception 'FAIL: authenticated should be able to execute get_credit_summary';
  end if;
  if has_function_privilege('anon', 'public.get_credit_summary()', 'EXECUTE') then
    raise exception 'FAIL: anon should not be able to execute get_credit_summary';
  end if;
  raise notice 'PASS: get_credit_summary is grant-restricted to authenticated';
end $$;

do $$ begin raise notice '=== get_credit_summary CHECKS PASSED ==='; end $$;
