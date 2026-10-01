-- 006_achievements_levels_test.sql
-- Stage 12 adds no new migration - calculate_level(), award_xp() and
-- check_achievements() were all written and exercised (for XP itself)
-- back in Stage 2, but 001_functional_test.sql only ever checks the xp
-- column after one 10-XP award, deep inside level 1 - it never actually
-- confirms profiles.level gets recalculated correctly, and never checks
-- who can read the achievements/user_achievements tables this stage's
-- API depends on. This test covers exactly those two gaps.

\set ON_ERROR_STOP on

create temporary table if not exists test_state (key text primary key, value text);

create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ------------------------------------------------ calculate_level() boundaries
-- Pure function, but internal-only (no client EXECUTE grant - it's in
-- the same revoke batch as award_xp/check_achievements in
-- 015_functions.sql), so this part runs as postgres, same as
-- confirming reward_task_completion's own internal-only status in
-- 001_functional_test.sql. greatest(1, floor(xp/1000)+1): level 1 from
-- 0 up to 999, level 2 starts exactly at 1000.
do $$
begin
  if public.calculate_level(0) <> 1 then raise exception 'FAIL: calculate_level(0) should be 1'; end if;
  if public.calculate_level(999) <> 1 then raise exception 'FAIL: calculate_level(999) should still be 1'; end if;
  if public.calculate_level(1000) <> 2 then raise exception 'FAIL: calculate_level(1000) should be 2 - the boundary is inclusive'; end if;
  if public.calculate_level(2999) <> 3 then raise exception 'FAIL: calculate_level(2999) should be 3'; end if;
  if public.calculate_level(3000) <> 4 then raise exception 'FAIL: calculate_level(3000) should be 4'; end if;
  raise notice 'PASS: calculate_level() boundaries are correct (1000 XP per level, boundary inclusive)';
end $$;

-- ------------------------------------------------------- award_xp() crossing a level
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000500', 'nora@example.com');

-- Seeded directly (not via award_xp, which is internal-only) to put
-- nora 5 XP below the level 1 -> 2 boundary, so the one award_xp() call
-- below has to cross it for the test to mean anything.
update public.profiles set xp = 995, level = 1 where id = '00000000-0000-0000-0000-000000000500';

select public.award_xp('00000000-0000-0000-0000-000000000500', 10);

do $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = '00000000-0000-0000-0000-000000000500';
  if v_profile.xp <> 1005 then
    raise exception 'FAIL: award_xp should have left xp at 995+10=1005, got %', v_profile.xp;
  end if;
  if v_profile.level <> 2 then
    raise exception 'FAIL: award_xp should have recalculated level to 2 once xp crossed 1000, got %', v_profile.level;
  end if;
  raise notice 'PASS: award_xp() updates both xp and the derived level together when a level boundary is crossed';
end $$;

-- --------------------------------------------------- achievements visibility
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000501', 'oscar@example.com');

-- Inserted directly, standing in for what check_achievements() would
-- insert after a real event (already exercised end-to-end by
-- 001_functional_test.sql's first_task check) - this test is about who
-- can read the row once it exists, not about earning it.
insert into public.user_achievements (user_id, achievement_id)
select '00000000-0000-0000-0000-000000000500', id from public.achievements where code = 'first_task';

grant select on test_state to authenticated;
grant execute on function test_get(text) to authenticated;
set role authenticated;

-- oscar, unrelated to nora, can still see the catalog and nora's unlock -
-- both tables are deliberately public to any authenticated user
-- (achievements_select_all, user_achievements_select_all, 014_rls.sql),
-- the same "display feed" shape as activity.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000501', false);
do $$
begin
  if not exists (select 1 from public.achievements where code = 'first_task') then
    raise exception 'FAIL: oscar should be able to read the achievement catalog';
  end if;
  if not exists (
    select 1 from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
    where ua.user_id = '00000000-0000-0000-0000-000000000500' and a.code = 'first_task'
  ) then
    raise exception 'FAIL: oscar should be able to see nora''s unlocked achievement - user_achievements_select_all is deliberately public';
  end if;
  raise notice 'PASS: an unrelated authenticated user can read the achievement catalog and another user''s unlocks, as designed';
end $$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.achievements', 'SELECT') then
    raise exception 'FAIL: anon should have no access to achievements';
  end if;
  if has_table_privilege('anon', 'public.user_achievements', 'SELECT') then
    raise exception 'FAIL: anon should have no access to user_achievements';
  end if;
  raise notice 'PASS: both achievements tables require authenticated, even though public means public-to-authenticated';
end $$;

do $$ begin raise notice '=== achievements / levels CHECKS PASSED ==='; end $$;
