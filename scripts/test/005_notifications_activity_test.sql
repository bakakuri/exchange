-- 005_notifications_activity_test.sql
-- Validates the RLS policies Stage 11's API newly depends on
-- (014_rls.sql, written back in Stage 2 but never directly exercised
-- under `set role authenticated` until now): notifications_select_own
-- and notifications_mark_read_own (private, own rows only) and
-- activity_select_all (deliberately public to any authenticated user -
-- 009_activity.sql: "a user-facing feed... for display"). No new
-- migration in this stage, so this is pure regression coverage for
-- assumptions server/services/{notification,activity}.service.js make.

\set ON_ERROR_STOP on

create temporary table if not exists test_state (key text primary key, value text);

create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000400', 'liam@example.com'),
  ('00000000-0000-0000-0000-000000000401', 'mia@example.com');

-- A notification and an activity row for liam, created the same way
-- 015_functions.sql's own functions do it (direct insert here, since
-- that codepath is already exercised by 001_functional_test.sql - this
-- test is about who can read/update the rows once they exist, not about
-- who creates them).
with ins as (
  insert into public.notifications (user_id, type, title, body, dedup_key)
  values ('00000000-0000-0000-0000-000000000400', 'admin_message', 'Welcome', 'Thanks for joining.', 'test:005:welcome')
  returning id
)
select test_set('notification_id', id::text) from ins;

insert into public.activity (user_id, type)
values ('00000000-0000-0000-0000-000000000400', 'campaign_created');

-- ---------------------------------------------------------- assertions
grant select on test_state to authenticated;
grant execute on function test_get(text) to authenticated;
set role authenticated;

-- liam sees his own notification and can mark it read.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000400', false);
do $$
declare
  v_read_at timestamptz;
begin
  if not exists (select 1 from public.notifications where id = test_get('notification_id')::uuid) then
    raise exception 'FAIL: liam should see his own notification';
  end if;

  update public.notifications set read_at = now() where id = test_get('notification_id')::uuid;

  select read_at into v_read_at from public.notifications where id = test_get('notification_id')::uuid;
  if v_read_at is null then
    raise exception 'FAIL: liam should be able to mark his own notification read';
  end if;

  raise notice 'PASS: liam can read and mark read his own notification';
end $$;

-- mia cannot see liam's notification, and updating it as her reaches
-- zero rows (RLS silently excludes it, not an error - the same
-- "not found, not forbidden" shape notification.service.js's markRead
-- already assumes).
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000401', false);
do $$
declare
  v_row_count integer;
begin
  if exists (select 1 from public.notifications where id = test_get('notification_id')::uuid) then
    raise exception 'FAIL: mia should not see liam''s notification';
  end if;

  update public.notifications set read_at = now() where id = test_get('notification_id')::uuid;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 0 then
    raise exception 'FAIL: mia updating liam''s notification should match zero rows under RLS';
  end if;

  raise notice 'PASS: notifications_select_own and notifications_mark_read_own keep mia out of liam''s notification entirely';
end $$;

-- activity is the deliberate exception: mia CAN see liam's activity row,
-- by design (activity_select_all - a public display feed, not private
-- data the way notifications are).
do $$
begin
  if not exists (select 1 from public.activity where user_id = '00000000-0000-0000-0000-000000000400' and type = 'campaign_created') then
    raise exception 'FAIL: mia should see liam''s activity - activity_select_all is deliberately public';
  end if;
  raise notice 'PASS: activity_select_all lets an unrelated authenticated user read another user''s activity feed, as designed';
end $$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.notifications', 'SELECT') then
    raise exception 'FAIL: anon should have no access to notifications';
  end if;
  if has_table_privilege('anon', 'public.activity', 'SELECT') then
    raise exception 'FAIL: anon should have no access to activity (public means public-to-authenticated, not public-to-anon)';
  end if;
  raise notice 'PASS: both notifications and activity require authentication, even though activity is otherwise unrestricted';
end $$;

do $$ begin raise notice '=== notifications / activity RLS CHECKS PASSED ==='; end $$;
