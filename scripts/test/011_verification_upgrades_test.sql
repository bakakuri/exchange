-- 011_verification_upgrades_test.sql
-- 020_verification_upgrades.sql: screenshot proofs, link-click tasks,
-- 24-hour auto-approval / expiry, creator track record, grants.
-- Same conventions as 001: app.current_user_id stands in for auth.uid(),
-- every check RAISEs NOTICE 'PASS' or an EXCEPTION.

\set ON_ERROR_STOP on

create temporary table t20 (key text primary key, value text);
create or replace function t20_get(p_key text) returns text language sql as
  $$ select value from t20 where key = p_key $$;
create or replace function t20_set(p_key text, p_value text) returns void language sql as
  $$ insert into t20 (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000900', 'admin20@example.com'),
  ('00000000-0000-0000-0000-000000000901', 'cara@example.com'),
  ('00000000-0000-0000-0000-000000000902', 'dan@example.com'),
  ('00000000-0000-0000-0000-000000000903', 'eve@example.com'),
  ('00000000-0000-0000-0000-000000000904', 'finn@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000900';

-- Follow / like tasks need the doer's linked account (021).
insert into public.social_profiles (user_id, platform, username, profile_url) values
  ('00000000-0000-0000-0000-000000000902', 'instagram', 'dan', 'https://instagram.com/dan'),
  ('00000000-0000-0000-0000-000000000903', 'instagram', 'eve', 'https://instagram.com/eve'),
  ('00000000-0000-0000-0000-000000000903', 'tiktok', 'eve', 'https://tiktok.com/@eve'),
  ('00000000-0000-0000-0000-000000000904', 'instagram', 'finn', 'https://instagram.com/finn');

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000900', false);
select public.admin_credit_adjustment('00000000-0000-0000-0000-000000000901', 1000, 'seed for 020 tests');

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000901', false); -- cara
select t20_set('camp_a', public.create_campaign('Follow cara', '', 'instagram', 'follow',
  'https://instagram.com/cara', '', 'manual_proof', 10, 5)::text);
select t20_set('task_a', id::text) from public.tasks where campaign_id = t20_get('camp_a')::uuid;
select t20_set('camp_b', public.create_campaign('Visit cara', '', 'other', 'visit',
  'https://example.com/cara', '', 'link_click', 5, 3)::text);
select t20_set('task_b', id::text) from public.tasks where campaign_id = t20_get('camp_b')::uuid;

-- --------------------------------------------- link click only for visits
do $$
begin
  begin
    perform public.create_campaign('Bad', '', 'instagram', 'follow', 'https://instagram.com/x', '', 'link_click', 5, 1);
    raise exception 'FAIL: a follow task was created with link_click verification';
  exception when check_violation then
    raise notice 'PASS: link_click is refused for a follow task (link_click_task_types)';
  end;
end $$;

-- ------------------------------------------------------- screenshot proof
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000902', false); -- dan
select t20_set('dan_a', public.submit_task_verification(t20_get('task_a')::uuid, null, null,
  '00000000-0000-0000-0000-000000000902/11111111-1111-4111-8111-111111111111.webp', (select id from public.social_profiles where user_id = auth.uid() and platform = 'instagram'))::text);

do $$
begin
  if not exists (
    select 1 from public.completion_details
    where id = t20_get('dan_a')::uuid
      and proof_image_path = '00000000-0000-0000-0000-000000000902/11111111-1111-4111-8111-111111111111.webp'
      and status = 'pending' and auto_approved = false and verification_method = 'manual_proof'
  ) then
    raise exception 'FAIL: a screenshot-only submission was not stored as pending with its image path';
  end if;
  raise notice 'PASS: a screenshot alone is accepted as proof and shows in completion_details';
end $$;

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000903', false); -- eve
do $$
begin
  begin
    perform public.submit_task_verification(t20_get('task_a')::uuid, null, null,
      '00000000-0000-0000-0000-000000000902/22222222-2222-4222-8222-222222222222.png');
    raise exception 'FAIL: eve submitted a screenshot from dan''s folder';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: invalid screenshot%' then raise; end if;
    raise notice 'PASS: a screenshot outside the caller''s own folder is refused';
  end;
  begin
    perform public.submit_task_verification(t20_get('task_a')::uuid, null, null, null);
    raise exception 'FAIL: a submission with no proof at all was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
    raise notice 'PASS: a submission needs a link, a note or a screenshot';
  end;
  begin
    perform public.submit_task_verification(t20_get('task_a')::uuid, null, null, 'not/a-valid-path.gif');
    raise exception 'FAIL: a malformed image path was accepted';
  exception when others then
    -- either the folder check or the path-format constraint stops it
    if sqlerrm not like 'VALIDATION_ERROR%' and sqlstate <> '23514' then raise; end if;
    raise notice 'PASS: a malformed image path is refused';
  end;
end $$;

select t20_set('eve_a', public.submit_task_verification(t20_get('task_a')::uuid, null, 'Followed as @eve', null, (select id from public.social_profiles where user_id = auth.uid() and platform = 'instagram'))::text);

-- ------------------------------------------------------------ link clicks
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000902', false); -- dan
do $$
begin
  begin
    perform public.submit_task_verification(t20_get('task_b')::uuid, 'https://example.com/proof', null, null);
    raise exception 'FAIL: proof was accepted for a link-click task';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: this task is completed by opening its link%' then raise; end if;
    raise notice 'PASS: link-click tasks don''t take manual proof';
  end;
  begin
    perform public.complete_link_click_task(t20_get('task_b')::uuid);
    raise exception 'FAIL: a link-click task was completed without opening the link';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: open the link first%' then raise; end if;
    raise notice 'PASS: completing needs a recorded click';
  end;
  begin
    perform public.record_task_link_click(t20_get('task_a')::uuid);
    raise exception 'FAIL: a click was recorded on a proof task';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: this task needs proof%' then raise; end if;
    raise notice 'PASS: clicks are only recorded on link-click tasks';
  end;
end $$;

select t20_set('click1', public.record_task_link_click(t20_get('task_b')::uuid)::text);
select t20_set('click2', public.record_task_link_click(t20_get('task_b')::uuid)::text);

do $$
begin
  if t20_get('click1') <> t20_get('click2') then
    raise exception 'FAIL: clicking again restarted the wait';
  end if;
  raise notice 'PASS: the first click is kept';
  begin
    perform public.complete_link_click_task(t20_get('task_b')::uuid);
    raise exception 'FAIL: a link-click task paid out immediately after the click';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: keep the page open%' then raise; end if;
    raise notice 'PASS: completing within 15 seconds of the click is refused';
  end;
end $$;

-- the member waited: move the click 20 seconds into the past
update public.task_link_clicks set clicked_at = now() - interval '20 seconds'
where task_id = t20_get('task_b')::uuid and user_id = '00000000-0000-0000-0000-000000000902';

select t20_set('dan_credits_before', credits::text) from public.profiles where id = '00000000-0000-0000-0000-000000000902';
select t20_set('dan_b', public.complete_link_click_task(t20_get('task_b')::uuid)::text);

do $$
begin
  if not exists (
    select 1 from public.completion_details
    where id = t20_get('dan_b')::uuid and status = 'approved' and auto_approved
      and link_clicked_at is not null and reviewed_by is null
  ) then
    raise exception 'FAIL: link-click completion was not approved automatically';
  end if;
  if (select credits from public.profiles where id = '00000000-0000-0000-0000-000000000902')
     <> t20_get('dan_credits_before')::int + 5 then
    raise exception 'FAIL: link-click reward was not paid';
  end if;
  if (select remaining_budget from public.campaigns where id = t20_get('camp_b')::uuid) <> 10 then
    raise exception 'FAIL: link-click reward was not taken from the campaign budget';
  end if;
  raise notice 'PASS: 15 s after the click the reward is paid at once from the campaign budget';
  begin
    perform public.record_task_link_click(t20_get('task_b')::uuid);
    raise exception 'FAIL: a completed link-click task accepted another click';
  exception when others then
    if sqlerrm not like 'TASK_ALREADY_COMPLETED%' then raise; end if;
    raise notice 'PASS: a link-click task pays once per member';
  end;
end $$;

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000901', false); -- cara
do $$
begin
  begin
    perform public.record_task_link_click(t20_get('task_b')::uuid);
    raise exception 'FAIL: the creator clicked their own link-click task';
  exception when others then
    if sqlerrm not like 'SELF_TASK_FORBIDDEN%' then raise; end if;
    raise notice 'PASS: creators can''t complete their own link-click task';
  end;
end $$;

-- ------------------------------------------------------- auto-approval
-- dan's screenshot submission on task A is 25 hours old; eve's is fresh.
update public.task_completions set created_at = now() - interval '25 hours' where id = t20_get('dan_a')::uuid;
select t20_set('dan_credits_before', credits::text) from public.profiles where id = '00000000-0000-0000-0000-000000000902';
select t20_set('auto_count', public.auto_approve_overdue_completions()::text);

do $$
begin
  if t20_get('auto_count')::int <> 1 then
    raise exception 'FAIL: expected 1 overdue completion handled, got %', t20_get('auto_count');
  end if;
  if not exists (select 1 from public.task_completions where id = t20_get('dan_a')::uuid and status = 'approved' and auto_approved) then
    raise exception 'FAIL: the 25-hour-old submission was not auto-approved';
  end if;
  if (select credits from public.profiles where id = '00000000-0000-0000-0000-000000000902')
     <> t20_get('dan_credits_before')::int + 10 then
    raise exception 'FAIL: auto-approval did not pay the reward';
  end if;
  if not exists (select 1 from public.task_completions where id = t20_get('eve_a')::uuid and status = 'pending') then
    raise exception 'FAIL: a fresh submission was touched by auto-approval';
  end if;
  if not exists (select 1 from public.audit_logs where target_id = t20_get('dan_a')::uuid and action = 'verification.auto_approved') then
    raise exception 'FAIL: auto-approval was not written to the audit log';
  end if;
  raise notice 'PASS: unreviewed for 24 h → approved and paid; newer submissions wait';
end $$;

select t20_set('auto_count', public.auto_approve_overdue_completions()::text);
do $$
begin
  if t20_get('auto_count')::int <> 0 then
    raise exception 'FAIL: a second run handled % completions again', t20_get('auto_count');
  end if;
  raise notice 'PASS: running again does nothing more';
end $$;

-- --------------------------------------------- expiry on a dead campaign
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000901', false); -- cara
select t20_set('camp_c', public.create_campaign('Like cara', '', 'tiktok', 'like',
  'https://tiktok.com/@cara/video/1', '', 'manual_proof', 10, 2)::text);
select t20_set('task_c', id::text) from public.tasks where campaign_id = t20_get('camp_c')::uuid;

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000903', false); -- eve
select t20_set('eve_c', public.submit_task_verification(t20_get('task_c')::uuid, 'https://tiktok.com/proof', null, null, (select id from public.social_profiles where user_id = auth.uid() and platform = 'tiktok'))::text);

-- Since 021 a proof sent before a cancellation keeps its place and is still
-- paid (012 covers that). This checks the expiry path, for a proof that
-- holds no place - one sent before 021, when places weren't held.
update public.task_completions set holds_slot = false where id = t20_get('eve_c')::uuid;
update public.campaigns set reserved_count = 0 where id = t20_get('camp_c')::uuid;

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000901', false); -- cara
select public.cancel_campaign(t20_get('camp_c')::uuid, 'changed my mind');
update public.task_completions set created_at = now() - interval '30 hours' where id = t20_get('eve_c')::uuid;
select public.auto_approve_overdue_completions();

do $$
begin
  if not exists (select 1 from public.task_completions where id = t20_get('eve_c')::uuid and status = 'expired') then
    raise exception 'FAIL: a submission on a cancelled campaign was not expired';
  end if;
  if not exists (
    select 1 from public.notifications
    where user_id = '00000000-0000-0000-0000-000000000903' and title = 'Submission expired'
  ) then
    raise exception 'FAIL: no expiry notification for eve';
  end if;
  raise notice 'PASS: a submission whose campaign can no longer pay is expired, with a notification';
end $$;

-- ------------------------------------------------- creator track record
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000904', false); -- finn
select t20_set('finn_a', public.submit_task_verification(t20_get('task_a')::uuid, null, 'done', null, (select id from public.social_profiles where user_id = auth.uid() and platform = 'instagram'))::text);

select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000901', false); -- cara
select public.review_task_verification(t20_get('finn_a')::uuid, 'approved', null);
select public.review_task_verification(t20_get('eve_a')::uuid, 'rejected', 'No follow on my page');

do $$
declare
  r record;
begin
  select * into r from public.creator_review_stats(array['00000000-0000-0000-0000-000000000901'::uuid]);
  -- by hand: finn approved, eve rejected. Not counted: dan's auto-approval
  -- (timeout) and dan's link-click reward.
  if r.approved <> 1 or r.rejected <> 1 then
    raise exception 'FAIL: creator_review_stats gave approved=% rejected=% (expected 1/1)', r.approved, r.rejected;
  end if;
  raise notice 'PASS: creator_review_stats counts only the creator''s own decisions';
end $$;

-- --------------------------------------------------------------- grants
do $$
begin
  if has_function_privilege('authenticated', 'public.auto_approve_overdue_completions(integer)', 'execute') then
    raise exception 'FAIL: members can run auto-approval';
  end if;
  if has_function_privilege('authenticated', 'public.check_link_click_task(uuid, uuid)', 'execute') then
    raise exception 'FAIL: members can call the internal link-click check';
  end if;
  if not has_function_privilege('authenticated', 'public.record_task_link_click(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.complete_link_click_task(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.creator_review_stats(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.submit_task_verification(uuid, text, text, text, uuid)', 'execute') then
    raise exception 'FAIL: members are missing a grant they need';
  end if;
  if has_table_privilege('authenticated', 'public.task_link_clicks', 'select') then
    raise exception 'FAIL: members can read the click log directly';
  end if;
  raise notice 'PASS: grants - members get the four entry points, nothing internal';
end $$;
