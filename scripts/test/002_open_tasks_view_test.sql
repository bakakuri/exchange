-- 002_open_tasks_view_test.sql
-- Validates public.open_tasks (017_open_tasks_view.sql) in isolation:
-- which campaign states make a task open/closed, that it carries no
-- privilege of its own (grants/RLS on the underlying tables still
-- apply), and that anon still has no access. Runs against the same
-- freshly migrated database as 001_functional_test.sql, right after it
-- (see README) - uses its own, non-colliding fixture ids so it doesn't
-- need to touch or reset that script's data.

\set ON_ERROR_STOP on

create temporary table if not exists test_state (key text primary key, value text);

create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'dana@example.com'),   -- campaign creator
  ('00000000-0000-0000-0000-000000000102', 'erin@example.com');   -- an unrelated completer

-- Bootstrap an admin directly, same as 001_functional_test.sql, so this
-- file has no ordering dependency on that one.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000100', 'admin2@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000100';

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000100', false);
select public.admin_credit_adjustment('00000000-0000-0000-0000-000000000101', 1000, 'seed for open_tasks view test');

-- ------------------------------------------------------- dana's campaigns
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000101', false);

-- A: active, plenty of room - should be open. create_campaign() is
-- volatile and must never be called inline inside a query filter (it
-- could be invoked once per row scanned) - always capture its result
-- first, the same two-step pattern used for B/C/D below.
select test_set('campaign_open', public.create_campaign(
  'Open task', '', 'instagram', 'follow', 'https://instagram.com/open', '', 'manual_proof', 10, 2
)::text);
select test_set('task_open', id::text) from public.tasks where campaign_id = test_get('campaign_open')::uuid;

-- B: active, single slot - completed and approved below, so it should
-- close once completed_count reaches desired_completions.
select test_set('campaign_full', public.create_campaign(
  'Will fill up', '', 'instagram', 'follow', 'https://instagram.com/full', '', 'manual_proof', 10, 1
)::text);
select test_set('task_full', id::text) from public.tasks where campaign_id = test_get('campaign_full')::uuid;

-- C: active - paused below, so it should close.
select test_set('campaign_paused', public.create_campaign(
  'Will pause', '', 'instagram', 'follow', 'https://instagram.com/paused', '', 'manual_proof', 10, 2
)::text);
select test_set('task_paused', id::text) from public.tasks where campaign_id = test_get('campaign_paused')::uuid;

-- D: active - cancelled below, so it should close.
select test_set('campaign_cancelled', public.create_campaign(
  'Will cancel', '', 'instagram', 'follow', 'https://instagram.com/cancelled', '', 'manual_proof', 10, 2
)::text);
select test_set('task_cancelled', id::text) from public.tasks where campaign_id = test_get('campaign_cancelled')::uuid;

do $$
begin
  if (select count(*) from public.open_tasks where id = test_get('task_open')::uuid) <> 1 then
    raise exception 'FAIL: a fresh active campaign with room should be open';
  end if;
  raise notice 'PASS: a fresh active campaign with completion slots and budget is open';
end $$;

-- ---------------------------------------------- fill campaign B to capacity
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000102', false); -- erin
select test_set('completion_full', public.submit_task_verification(test_get('task_full')::uuid, null, 'done')::text);

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000101', false); -- dana reviews
select public.review_task_verification(test_get('completion_full')::uuid, 'approved', 'looks good');

do $$
begin
  if exists (select 1 from public.open_tasks where id = test_get('task_full')::uuid) then
    raise exception 'FAIL: a campaign at its completion target should no longer be open';
  end if;
  raise notice 'PASS: a campaign that reached desired_completions is excluded from open_tasks';
end $$;

-- ------------------------------------------------------------- pause & cancel
select public.set_campaign_pause_state(test_get('campaign_paused')::uuid, true);
select public.cancel_campaign(test_get('campaign_cancelled')::uuid, 'no longer needed');

do $$
begin
  if exists (select 1 from public.open_tasks where id = test_get('task_paused')::uuid) then
    raise exception 'FAIL: a paused campaign''s task should not be open';
  end if;
  raise notice 'PASS: a paused campaign is excluded from open_tasks';
end $$;

do $$
begin
  if exists (select 1 from public.open_tasks where id = test_get('task_cancelled')::uuid) then
    raise exception 'FAIL: a cancelled campaign''s task should not be open';
  end if;
  raise notice 'PASS: a cancelled campaign is excluded from open_tasks';
end $$;

-- ------------------------------------------------- the view is not viewer-aware
-- open_tasks answers "can anyone still complete this task", not "can you" -
-- excluding the viewer's own tasks is an API-layer browse choice
-- (task.service.js), deliberately not baked into the view itself.
do $$
begin
  if (select count(*) from public.open_tasks where id = test_get('task_open')::uuid) <> 1 then
    raise exception 'FAIL: open_tasks should not filter by viewer - it has no notion of one';
  end if;
  raise notice 'PASS: open_tasks includes the querying user''s own open tasks (self-exclusion is an API-layer concern)';
end $$;

-- ---------------------------------------------------------- grants / RLS
do $$
begin
  if not has_table_privilege('authenticated', 'public.open_tasks', 'SELECT') then
    raise exception 'FAIL: authenticated should be able to select from open_tasks';
  end if;
  if has_table_privilege('anon', 'public.open_tasks', 'SELECT') then
    raise exception 'FAIL: anon should not be able to select from open_tasks';
  end if;
  raise notice 'PASS: open_tasks is grant-restricted to authenticated, like tasks/campaigns themselves';
end $$;

-- A plain view with no security definer runs as the querying role, so
-- the underlying tasks/campaigns RLS policies (select-all for
-- authenticated) still decide visibility here - confirm an unrelated
-- authenticated user really can see it via the view, not just via a
-- privilege check.
--
-- test_state/test_get are owned by postgres (the connecting role); once
-- we switch to authenticated below, reading them needs its own grant -
-- select-only, since this section only reads ids captured earlier.
grant select on test_state to authenticated;
grant execute on function test_get(text) to authenticated;

set role authenticated;
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000102', false); -- erin, not dana

do $$
begin
  if (select count(*) from public.open_tasks where id = test_get('task_open')::uuid) <> 1 then
    raise exception 'FAIL: an unrelated authenticated user should see the open task via RLS select-all';
  end if;
  raise notice 'PASS: RLS on the underlying tables applies through the view for an unrelated authenticated user';
end $$;

reset role;

do $$ begin raise notice '=== open_tasks VIEW CHECKS PASSED ==='; end $$;
