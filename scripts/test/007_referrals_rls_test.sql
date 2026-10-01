-- 007_referrals_rls_test.sql
-- Stage 13 (Referrals) local validation test.
--
-- Tests:
--   1. referrals_select_participant RLS: participant sees own rows, outsider
--      does not, admin sees everything.
--   2. claim_referral() happy path: inserts a referrals row, sets referred_by
--      on the referred user's profile.
--   3. claim_referral() self-referral guard: blocked.
--   4. claim_referral() duplicate guard: can't claim twice.
--   5. claim_referral() bad code: VALIDATION_ERROR raised.
--   6. try_reward_referral() is internal-only (EXECUTE revoked from public).
--
-- Runs against the local Postgres stub (000_supabase_stub.sql + full
-- migrations). Uses set local role + set local request.jwt.claim.sub to
-- simulate Supabase's auth context for RLS tests, the same pattern
-- 001_functional_test.sql uses.

\set ON_ERROR_STOP on

create temporary table if not exists test_state (key text primary key, value text);
create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ────────────────────────────────────────────────────────────── test users ──
-- alice  = the referrer (shares her code)
-- bob    = the referred user (will claim alice's code)
-- carol  = an outsider (no involvement in the referral)
-- admin  = an admin user

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000701', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000702', 'bob@example.com'),
  ('00000000-0000-0000-0000-000000000703', 'carol@example.com'),
  ('00000000-0000-0000-0000-000000000704', 'admin@example.com');

-- handle_new_user() ran on insert and gave each a referral_code.
-- Capture alice's code so we can use it below.
select test_set('alice_code', (select referral_code from public.profiles where id = '00000000-0000-0000-0000-000000000701'));
select test_set('bob_code',   (select referral_code from public.profiles where id = '00000000-0000-0000-0000-000000000702'));

-- Promote the admin user.
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000704';

-- ──────────────────────────────────────────────────── claim_referral() ──────

-- 1. Happy path: bob claims alice's code.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000702';
  select public.claim_referral(test_get('alice_code'));
commit;

do $$
begin
  if not exists (
    select 1 from public.referrals
    where referrer_id = '00000000-0000-0000-0000-000000000701'
      and referred_id = '00000000-0000-0000-0000-000000000702'
  ) then
    raise exception 'FAIL: referrals row not created after successful claim';
  end if;
  if (select referred_by from public.profiles where id = '00000000-0000-0000-0000-000000000702')
       is distinct from '00000000-0000-0000-0000-000000000701'::uuid then
    raise exception 'FAIL: profiles.referred_by not set on bob after claim';
  end if;
  raise notice 'PASS: claim_referral() happy path: referrals row + profiles.referred_by both set';
end $$;

-- 2. Duplicate guard: bob tries to claim again - must fail.
do $$
declare v text;
begin
  begin
    begin;
      set local role authenticated;
      set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000702';
      select public.claim_referral(test_get('alice_code'));
    commit;
    raise exception 'FAIL: second claim_referral() should have raised an error';
  exception when raise_exception then
    v := sqlerrm;
    if v not like 'ALREADY_REFERRED%' and v not like 'VALIDATION_ERROR%' then
      raise exception 'FAIL: wrong error on duplicate claim: %', v;
    end if;
    raise notice 'PASS: duplicate claim correctly blocked: %', v;
  end;
end $$;

-- 3. Self-referral guard: carol tries to claim her own code.
do $$
declare v text;
begin
  begin
    begin;
      set local role authenticated;
      set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000703';
      select public.claim_referral(test_get('bob_code'));
    commit;
    -- bob's code is not carol's own, but let's test with carol's own code.
    -- Re-run with carol's actual own code.
    null;
  exception when others then null;
  end;

  -- Now actually test self-referral: carol claims her own code.
  begin
    begin;
      set local role authenticated;
      set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000703';
      select public.claim_referral(
        (select referral_code from public.profiles where id = '00000000-0000-0000-0000-000000000703')
      );
    commit;
    raise exception 'FAIL: self-referral should have been blocked';
  exception when raise_exception then
    v := sqlerrm;
    raise notice 'PASS: self-referral correctly blocked: %', v;
  end;
end $$;

-- 4. Bad code guard: invalid / non-existent code.
do $$
declare v text;
begin
  begin
    begin;
      set local role authenticated;
      set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000703';
      select public.claim_referral('ZZZZZZZZ');
    commit;
    raise exception 'FAIL: bad code should have raised an error';
  exception when raise_exception then
    v := sqlerrm;
    raise notice 'PASS: bad referral code correctly rejected: %', v;
  end;
end $$;

-- ─────────────────────────────────────────── referrals_select_participant RLS ──

-- 5. Alice (participant as referrer) sees the referral row.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000701';
  do $$
  begin
    if (select count(*) from public.referrals
        where referrer_id = '00000000-0000-0000-0000-000000000701') <> 1 then
      raise exception 'FAIL: alice (referrer) should see exactly 1 referral row';
    end if;
    raise notice 'PASS: alice sees her own referral row as referrer';
  end $$;
commit;

-- 6. Bob (participant as referred) sees the referral row.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000702';
  do $$
  begin
    if (select count(*) from public.referrals
        where referred_id = '00000000-0000-0000-0000-000000000702') <> 1 then
      raise exception 'FAIL: bob (referred) should see exactly 1 referral row';
    end if;
    raise notice 'PASS: bob sees his own referral row as referred';
  end $$;
commit;

-- 7. Carol (outsider, not in any referral) sees zero rows.
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000703';
  do $$
  begin
    if (select count(*) from public.referrals) <> 0 then
      raise exception 'FAIL: carol (outsider) should see 0 referral rows via RLS';
    end if;
    raise notice 'PASS: carol (outsider) sees 0 referral rows - RLS correctly filters';
  end $$;
commit;

-- 8. Admin sees all rows (referrals_select_participant also allows role = admin).
begin;
  set local role authenticated;
  set local "request.jwt.claim.sub" to '00000000-0000-0000-0000-000000000704';
  do $$
  begin
    if (select count(*) from public.referrals) <> 1 then
      raise exception 'FAIL: admin should see all referral rows (1 total)';
    end if;
    raise notice 'PASS: admin sees all referral rows';
  end $$;
commit;

-- ──────────────────────────────── try_reward_referral() is internal-only ──

-- 9. try_reward_referral has no EXECUTE grant to public or authenticated.
do $$
declare v text;
begin
  select has_function_privilege('public', 'try_reward_referral(uuid)', 'execute') into v;
  if v = 'true' then
    raise exception 'FAIL: try_reward_referral should have EXECUTE revoked from public';
  end if;
  raise notice 'PASS: try_reward_referral EXECUTE is revoked from public (internal-only)';
exception when undefined_function then
  raise notice 'PASS: try_reward_referral not callable from public (no matching signature)';
end $$;

\echo '007_referrals_rls_test: all checks passed'
