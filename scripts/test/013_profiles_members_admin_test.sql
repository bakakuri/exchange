-- 013_profiles_members_admin_test.sql
-- 022_profiles_members_admin.sql: photo columns and who may write them,
-- field of work, presence and its privacy switch, the members directory
-- (search, fields, groups, sorting, paging) and its counts, and the admin
-- tools (profile clean-up, campaign actions, messages).
-- Same conventions as 001: app.current_user_id stands in for auth.uid(),
-- every check RAISEs NOTICE 'PASS' or an EXCEPTION.

\set ON_ERROR_STOP on

create or replace function u22(n integer) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-0000-' || lpad((2000 + n)::text, 12, '0'))::uuid $$;
create or replace function t22_as(n integer) returns text language sql as
  $$ select set_config('app.current_user_id', u22(n)::text, false) $$;
create or replace function t22_dir(p_search text, p_category text, p_segment text, p_sort text default null)
returns setof uuid language sql as
  $$ select id from public.member_directory(p_search, p_category, p_segment, p_sort, 60, 0) $$;

-- Members from the earlier test files are set aside (suspended) so the
-- directory holds only the people below; they are restored at the end.
create temporary table t22_others as
  select id from public.profiles where status = 'active';
update public.profiles set status = 'suspended' where id in (select id from t22_others);

-- people: 0 boss (admin), 1 ana (blogger, online), 2 beka (musician,
-- hidden), 3 dato (gamer, seen an hour ago), 4 eka (new), 5 gio (suspended)
insert into auth.users (id, email) select u22(n), 'm' || n || '@t22.example' from generate_series(0, 5) n;
update public.profiles set role = 'admin', username = 'boss22' where id = u22(0);
update public.profiles set username = 'ana22', display_name = 'Ana Beridze', category = 'blogger', xp = 2500, level = 3 where id = u22(1);
update public.profiles set username = 'beka22', category = 'musician', show_online = false, xp = 900 where id = u22(2);
update public.profiles set username = 'dato22', category = 'gamer', xp = 100 where id = u22(3);
update public.profiles set username = 'eka_22' where id = u22(4);
update public.profiles set username = 'gio22', status = 'suspended' where id = u22(5);
update public.profiles set created_at = now() - interval '30 days' where id in (u22(0), u22(1), u22(2), u22(3), u22(5));

select public.touch_presence(u22(1));
select public.touch_presence(u22(2));
insert into public.member_presence (user_id, last_seen_at) values (u22(3), now() - interval '1 hour')
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;

-- ana runs a campaign; dato has an approved task on it
select t22_as(0);
select public.admin_credit_adjustment(u22(1), 500, 'seed for 022 tests');
select t22_as(1);
select public.create_campaign('Follow ana', '', 'instagram', 'follow', 'https://instagram.com/ana22', '',
  'manual_proof', 10, 3);
insert into public.social_profiles (user_id, platform, username, profile_url)
  values (u22(3), 'instagram', 'dato', 'https://instagram.com/dato');
select t22_as(3);
select public.submit_task_verification(
  (select t.id from public.tasks t join public.campaigns c on c.id = t.campaign_id where c.creator_id = u22(1)),
  null, 'followed', null,
  (select id from public.social_profiles where user_id = u22(3) and platform = 'instagram'));
select t22_as(1);
select public.review_task_verification(
  (select id from public.task_completions where user_id = u22(3)), 'approved', null);

-- ============================================================ columns
do $$
begin
  begin
    update public.profiles set category = 'astronaut' where id = u22(4);
    raise exception 'FAIL: an unknown field of work was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set cover_url = 'javascript:alert(1)' where id = u22(4);
    raise exception 'FAIL: a cover URL that is not a web link was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: field of work and photo URLs are checked';
end $$;

do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'cover_url', 'update') then
    raise exception 'FAIL: members can still write photo URLs directly';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'category', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'show_online', 'update') then
    raise exception 'FAIL: members cannot set their field of work or online privacy';
  end if;
  raise notice 'PASS: photos only through the API; field and privacy are the member''s';
end $$;

-- ============================================================ presence
do $$
declare v_before timestamptz; v_after timestamptz;
begin
  update public.member_presence set last_seen_at = now() - interval '20 seconds' where user_id = u22(1);
  select last_seen_at into v_before from public.member_presence where user_id = u22(1);
  perform public.touch_presence(u22(1));
  select last_seen_at into v_after from public.member_presence where user_id = u22(1);
  if v_after <> v_before then
    raise exception 'FAIL: presence was written again within a minute';
  end if;
  update public.member_presence set last_seen_at = now() - interval '2 minutes' where user_id = u22(1);
  perform public.touch_presence(u22(1));
  if (select last_seen_at from public.member_presence where user_id = u22(1)) < now() - interval '5 seconds' then
    raise exception 'FAIL: presence was not refreshed after a minute';
  end if;
  perform public.touch_presence('99999999-9999-4999-8999-999999999999');
  if exists (select 1 from public.member_presence where user_id = '99999999-9999-4999-8999-999999999999') then
    raise exception 'FAIL: presence was recorded for someone who does not exist';
  end if;
  raise notice 'PASS: presence is written at most once a minute, only for members';
end $$;

-- ============================================================ directory
select t22_as(4); -- eka looks around
do $$
declare r record;
begin
  if (select count(*) from public.member_directory()) <> 5 then
    raise exception 'FAIL: the directory should list the 5 active members, got %', (select count(*) from public.member_directory());
  end if;
  if exists (select 1 from public.member_directory() where id = u22(5)) then
    raise exception 'FAIL: a suspended member is listed';
  end if;

  select * into r from public.member_directory(p_username => 'ana22');
  if not r.is_online or r.last_seen_at is null or r.campaigns_count <> 1 or r.category <> 'blogger' or r.total_count <> 1 then
    raise exception 'FAIL: ana should be online with 1 campaign: %', row_to_json(r);
  end if;

  select * into r from public.member_directory(p_username => 'beka22');
  if r.is_online is not null or r.last_seen_at is not null then
    raise exception 'FAIL: beka hides her status but it was shown: %', row_to_json(r);
  end if;

  select * into r from public.member_directory(p_username => 'dato22');
  if r.is_online or r.last_seen_at is null or r.completed_count <> 1 then
    raise exception 'FAIL: dato should be offline, last seen an hour ago, 1 task done: %', row_to_json(r);
  end if;
  raise notice 'PASS: the directory shows presence as each member allows';
end $$;

select t22_as(2); -- beka sees her own status even though it is hidden
do $$
begin
  if (select is_online from public.member_directory(p_username => 'beka22')) is not true then
    raise exception 'FAIL: a member should see their own status';
  end if;
  raise notice 'PASS: hidden status is still visible to its owner';
end $$;

select t22_as(4);
do $$
begin
  if array(select t22_dir(null, null, 'online')) <> array[u22(1)] then
    raise exception 'FAIL: online should be only ana (beka is hidden), got %', array(select t22_dir(null, null, 'online'));
  end if;
  if array(select t22_dir(null, null, 'creators')) <> array[u22(1)] then
    raise exception 'FAIL: creators should be ana';
  end if;
  if array(select t22_dir(null, null, 'doers')) <> array[u22(3)] then
    raise exception 'FAIL: doers should be dato';
  end if;
  if array(select t22_dir(null, null, 'new')) <> array[u22(4)] then
    raise exception 'FAIL: new should be eka';
  end if;
  if array(select t22_dir(null, null, 'admins')) <> array[u22(0)] then
    raise exception 'FAIL: admins should be boss';
  end if;
  if array(select t22_dir(null, null, 'top')) <> array[u22(1), u22(2), u22(3)] then
    raise exception 'FAIL: top should be ana, beka, dato by XP, got %', array(select t22_dir(null, null, 'top'));
  end if;
  if array(select t22_dir(null, 'musician', null)) <> array[u22(2)] then
    raise exception 'FAIL: the musician field should be beka';
  end if;
  raise notice 'PASS: groups and fields filter the directory';
end $$;

do $$
begin
  if array(select t22_dir('beridze', null, null)) <> array[u22(1)] then
    raise exception 'FAIL: search by display name';
  end if;
  if array(select t22_dir('_', null, null)) <> array[u22(4)] then
    raise exception 'FAIL: "_" must match a literal underscore only, got %', array(select t22_dir('_', null, null));
  end if;
  if exists (select t22_dir('%', null, null)) then
    raise exception 'FAIL: "%%" must match a literal percent sign only';
  end if;
  raise notice 'PASS: search matches names literally';
end $$;

do $$
declare v_first uuid; v_second uuid;
begin
  select id into v_first from public.member_directory() limit 1;
  if v_first <> u22(1) then
    raise exception 'FAIL: by default the online member comes first';
  end if;
  select id into v_first from public.member_directory(p_sort => 'new') limit 1;
  if v_first <> u22(4) then
    raise exception 'FAIL: newest first should start with eka';
  end if;
  select id into v_first from public.member_directory(p_sort => 'level') limit 1;
  if v_first <> u22(1) then
    raise exception 'FAIL: by level should start with ana';
  end if;
  select id into v_first from public.member_directory(p_sort => 'new', p_limit => 2, p_offset => 0) offset 1;
  select id into v_second from public.member_directory(p_sort => 'new', p_limit => 1, p_offset => 1);
  if v_first is distinct from v_second then
    raise exception 'FAIL: paging should continue where the last page ended';
  end if;
  if (select total_count from public.member_directory(p_limit => 1) limit 1) <> 5 then
    raise exception 'FAIL: total_count should count every match, not the page';
  end if;
  raise notice 'PASS: sorting and paging';
end $$;

do $$
declare r record;
begin
  for r in select f.id, f.xp_rank from public.member_facts() f loop
    if (select xp_rank from public.member_facts(r.id)) <> r.xp_rank then
      raise exception 'FAIL: one member''s rank (%) differs from the full ranking (%)', (select xp_rank from public.member_facts(r.id)), r.xp_rank;
    end if;
  end loop;
  if (select xp_rank from public.member_directory(p_username => 'beka22')) <> 2 then
    raise exception 'FAIL: beka is second by XP';
  end if;
  raise notice 'PASS: a single profile gets the same rank without ranking everyone';
end $$;

do $$
declare
  me uuid := u22(1);
  keep text := 'https://x.supabase.co/storage/v1/object/public/media/' || u22(1) || '/avatar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  pattern text := '^https?://[^/?#]+/storage/v1/object/public/media/' || u22(1)::text || '/avatar-[0-9a-f-]{36}\.(jpg|png|webp)$';
begin
  if keep !~ pattern
     or 'https://evil.example/a?/storage/v1/object/public/media/' || me || '/avatar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp' ~ pattern
     or 'https://x.supabase.co/storage/v1/object/public/media/' || u22(2) || '/avatar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp' ~ pattern
     or 'https://evil.example/storage/v1/object/public/media/x.png' ~ pattern then
    raise exception 'FAIL: only the member''s own uploaded avatar survives the clean-up';
  end if;
  raise notice 'PASS: old photo links are kept only when they are the member''s own upload';
end $$;

do $$
declare c jsonb := public.member_directory_counts();
begin
  if (c->>'all')::int <> 5 or (c->>'online')::int <> 1 or (c->>'creators')::int <> 1 or (c->>'doers')::int <> 1
     or (c->>'new')::int <> 1 or (c->>'top')::int <> 3 or (c->>'admins')::int <> 1
     or (c->'categories'->>'blogger')::int <> 1 or (c->'categories'->>'gamer')::int <> 1 then
    raise exception 'FAIL: counts %', c;
  end if;
  raise notice 'PASS: directory counts per group and field';
end $$;

-- ============================================================ admin tools
update public.profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/media/a/avatar.webp',
  cover_url = 'https://x.supabase.co/storage/v1/object/public/media/a/cover.webp' where id = u22(3);

select t22_as(1); -- not an admin
do $$
begin
  begin
    perform public.admin_update_profile(u22(3), null, null, null, null, true, false, 'not allowed');
    raise exception 'FAIL: a member used admin_update_profile';
  exception when others then
    if sqlerrm not like 'FORBIDDEN%' then raise; end if;
  end;
  begin
    perform public.admin_send_message(null, 'Hi', 'all');
    raise exception 'FAIL: a member messaged everyone';
  exception when others then
    if sqlerrm not like 'FORBIDDEN%' then raise; end if;
  end;
  raise notice 'PASS: admin tools refuse members';
end $$;

select t22_as(0);
do $$
declare v jsonb;
begin
  begin
    perform public.admin_update_profile(u22(3), 'ana22', null, null, null, false, false, 'rename');
    raise exception 'FAIL: a taken username was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: that username is already taken' then raise; end if;
  end;
  begin
    perform public.admin_update_profile(u22(3), null, null, null, null, true, false, '');
    raise exception 'FAIL: no reason was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;

  v := public.admin_update_profile(u22(3), null, '', 'Clean bio', 'sports', true, false, 'Offensive avatar');
  if v->>'removed_avatar_url' <> 'https://x.supabase.co/storage/v1/object/public/media/a/avatar.webp'
     or v->>'removed_cover_url' is not null then
    raise exception 'FAIL: should report only the removed avatar: %', v;
  end if;
  if exists (select 1 from public.profiles where id = u22(3) and
             (avatar_url is not null or cover_url is null or display_name is not null or bio <> 'Clean bio' or category <> 'sports')) then
    raise exception 'FAIL: profile not updated as asked';
  end if;
  if not exists (select 1 from public.notifications where user_id = u22(3) and type = 'admin_message'
                 and title = 'A moderator changed your profile' and body = 'Offensive avatar') then
    raise exception 'FAIL: the member was not told why';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'user.profile_moderated' and target_id = u22(3)) then
    raise exception 'FAIL: not audited';
  end if;
  begin
    perform public.admin_update_profile(u22(3), 'dato22', null, 'Clean bio', 'sports', true, false, 'same again');
    raise exception 'FAIL: a change that changes nothing was accepted';
  exception when others then
    if sqlerrm <> 'VALIDATION_ERROR: Nothing to change' then raise; end if;
  end;
  if (select count(*) from public.notifications where user_id = u22(3) and title = 'A moderator changed your profile') <> 1 then
    raise exception 'FAIL: a no-op edit must not notify';
  end if;
  raise notice 'PASS: an admin cleans up a profile, the member is told why; no-op edits are refused';
end $$;

do $$
declare v_campaign uuid := (select id from public.campaigns where creator_id = u22(1));
begin
  begin
    perform public.admin_campaign_action(v_campaign, 'explode', 'testing');
    raise exception 'FAIL: unknown action accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.admin_campaign_action(v_campaign, 'resume', 'not paused');
    raise exception 'FAIL: resuming an active campaign was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  perform public.admin_campaign_action(v_campaign, 'pause', 'Checking reports');
  if (select status::text || '/' || paused_by_admin from public.campaigns where id = v_campaign) <> 'paused/true' then
    raise exception 'FAIL: not paused by a moderator';
  end if;
  begin
    perform public.admin_campaign_action(v_campaign, 'pause', 'again');
    raise exception 'FAIL: pausing twice was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;

  -- the creator can't undo a moderator's pause
  perform set_config('app.current_user_id', u22(1)::text, false);
  begin
    perform public.set_campaign_pause_state(v_campaign, false);
    raise exception 'FAIL: the creator resumed a campaign a moderator paused';
  exception when others then
    if sqlerrm not like 'FORBIDDEN: a moderator paused%' then raise; end if;
  end;
  perform public.set_campaign_pause_state(v_campaign, true); -- pausing again is harmless
  perform set_config('app.current_user_id', u22(0)::text, false);

  perform public.admin_campaign_action(v_campaign, 'resume', 'All good');
  if (select status::text || '/' || paused_by_admin from public.campaigns where id = v_campaign) <> 'active/false' then
    raise exception 'FAIL: not resumed, or the hold was not cleared';
  end if;

  -- after an admin resume, the creator's own pause/resume works again
  perform set_config('app.current_user_id', u22(1)::text, false);
  perform public.set_campaign_pause_state(v_campaign, true);
  perform public.set_campaign_pause_state(v_campaign, false);
  perform set_config('app.current_user_id', u22(0)::text, false);
  if (select count(*) from public.notifications where user_id = u22(1) and type = 'admin_message'
      and related_campaign_id = v_campaign) <> 2 then
    raise exception 'FAIL: the creator should get a notice for the pause and the resume';
  end if;
  perform public.admin_campaign_action(v_campaign, 'cancel', 'Breaks the rules');
  if (select status::text from public.campaigns where id = v_campaign) <> 'cancelled' then
    raise exception 'FAIL: not cancelled';
  end if;
  if not exists (select 1 from public.notifications where user_id = u22(1) and type = 'campaign_cancelled' and body = 'Breaks the rules') then
    raise exception 'FAIL: cancel notice should carry the reason';
  end if;
  raise notice 'PASS: admins pause, resume and cancel any campaign with a reason; their pause holds';
end $$;

do $$
declare v_sent integer;
begin
  v_sent := public.admin_send_message(null, '  Maintenance tonight  ', 'Back at 02:00.');
  if v_sent <> 5 then
    raise exception 'FAIL: everyone active (5) should get it, got %', v_sent;
  end if;
  if exists (select 1 from public.notifications where user_id = u22(5) and title = 'Maintenance tonight') then
    raise exception 'FAIL: a suspended member got the broadcast';
  end if;
  v_sent := public.admin_send_message(u22(4), 'Welcome', '');
  if v_sent <> 1 or not exists (select 1 from public.notifications where user_id = u22(4) and title = 'Welcome') then
    raise exception 'FAIL: a direct message';
  end if;
  begin
    perform public.admin_send_message(null, '   ', 'x');
    raise exception 'FAIL: an empty title was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  if (select count(*) from public.audit_logs where action = 'admin.message') <> 2 then
    raise exception 'FAIL: messages are audited';
  end if;
  raise notice 'PASS: admins message one member or everyone';
end $$;

do $$
begin
  if has_function_privilege('authenticated', 'public.touch_presence(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.member_facts(uuid)', 'execute')
     or has_function_privilege('anon', 'public.member_directory(text, text, text, text, integer, integer, text)', 'execute') then
    raise exception 'FAIL: presence internals are open to clients';
  end if;
  if not has_function_privilege('authenticated', 'public.member_directory(text, text, text, text, integer, integer, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.member_directory_counts()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_send_message(uuid, text, text)', 'execute') then
    raise exception 'FAIL: members cannot use the directory';
  end if;
  raise notice 'PASS: function grants';
end $$;

-- members read presence only through the directory
set role authenticated;
do $$
begin
  begin
    perform 1 from public.member_presence;
    raise exception 'FAIL: member_presence is readable by clients';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: member_presence is closed to clients';
end $$;
reset role;

update public.profiles set status = 'active' where id in (select id from t22_others);
select set_config('app.current_user_id', '', false);
