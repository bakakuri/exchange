-- 003_completion_details_view_test.sql
-- Validates public.completion_details (018_completion_details_view.sql):
-- the completer and the campaign creator both see a row through the
-- view, an unrelated third party sees neither, and review_notes is
-- visible to the completer after a rejection. Runs against the same
-- freshly migrated database as 001/002 (see README), with its own
-- non-colliding fixture ids.

\set ON_ERROR_STOP on

create temporary table if not exists test_state (key text primary key, value text);

create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000201', 'finn@example.com'),   -- campaign creator
  ('00000000-0000-0000-0000-000000000202', 'gina@example.com'),   -- completer
  ('00000000-0000-0000-0000-000000000203', 'hank@example.com');   -- unrelated third party

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000200', 'admin3@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000200';

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000200', false);
select public.admin_credit_adjustment('00000000-0000-0000-0000-000000000201', 100, 'seed for completion_details view test');

-- ------------------------------------------------------------ the loop
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000201', false); -- finn
select test_set('campaign_id', public.create_campaign(
  'Review me', '', 'instagram', 'follow', 'https://instagram.com/reviewme', '', 'manual_proof', 10, 2
)::text);
select test_set('task_id', id::text) from public.tasks where campaign_id = test_get('campaign_id')::uuid;

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000202', false); -- gina
-- a follow task needs the doer's linked account (021)
insert into public.social_profiles (user_id, platform, username, profile_url)
values ('00000000-0000-0000-0000-000000000202', 'instagram', 'gina', 'https://instagram.com/gina');
select test_set('completion_id', public.submit_task_verification(
  test_get('task_id')::uuid, null, 'proof of follow', null,
  (select id from public.social_profiles where user_id = auth.uid() and platform = 'instagram')
)::text);

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000201', false); -- finn reviews
select public.review_task_verification(test_get('completion_id')::uuid, 'rejected', 'screenshot is unclear');

-- ---------------------------------------------------------- assertions
grant select on test_state to authenticated;
grant execute on function test_get(text) to authenticated;
set role authenticated;

-- gina (the completer) should see her own completion, with the reviewer's notes.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000202', false);
do $$
declare
  v_row public.completion_details;
begin
  select * into v_row from public.completion_details where id = test_get('completion_id')::uuid;
  if not found then
    raise exception 'FAIL: the completer should see their own completion through the view';
  end if;
  if v_row.status <> 'rejected' or v_row.review_notes <> 'screenshot is unclear' then
    raise exception 'FAIL: the completer should see the reviewer''s decision and notes';
  end if;
  if v_row.campaign_title <> 'Review me' or v_row.campaign_creator_id <> '00000000-0000-0000-0000-000000000201' then
    raise exception 'FAIL: the view should carry the joined campaign fields';
  end if;
  raise notice 'PASS: the completer sees their own completion, enriched with campaign + review notes';
end $$;

-- finn (the campaign creator) should also see it.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000201', false);
do $$
begin
  if not exists (select 1 from public.completion_details where id = test_get('completion_id')::uuid) then
    raise exception 'FAIL: the campaign creator should see a completion on their own task';
  end if;
  raise notice 'PASS: the campaign creator sees a completion on their own campaign';
end $$;

-- hank (unrelated) should see nothing for this completion.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000203', false);
do $$
begin
  if exists (select 1 from public.completion_details where id = test_get('completion_id')::uuid) then
    raise exception 'FAIL: an unrelated user should not see someone else''s completion';
  end if;
  raise notice 'PASS: RLS hides the completion from an unrelated authenticated user, through the view';
end $$;

reset role;

do $$
begin
  if not has_table_privilege('authenticated', 'public.completion_details', 'SELECT') then
    raise exception 'FAIL: authenticated should be able to select from completion_details';
  end if;
  if has_table_privilege('anon', 'public.completion_details', 'SELECT') then
    raise exception 'FAIL: anon should not be able to select from completion_details';
  end if;
  raise notice 'PASS: completion_details is grant-restricted to authenticated';
end $$;

do $$ begin raise notice '=== completion_details VIEW CHECKS PASSED ==='; end $$;
