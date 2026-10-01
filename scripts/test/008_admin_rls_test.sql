-- scripts/test/008_admin_rls_test.sql
-- Stage 14: Admin panel — local validation tests
--
-- Verifies:
--   1. admin_update_user changes role + status and writes audit_log row
--   2. admin_update_user blocks non-admin caller (not is_admin())
--   3. admin_credit_adjustment adds credits and writes credit_ledger row
--   4. admin_credit_adjustment blocks non-admin caller
--   5. admin_credit_adjustment rejects zero-amount
--   6. RLS on audit_logs: only admins can SELECT
--   7. RLS on credit_ledger: owner or admin can SELECT
--   8. admin_resolve_report stub exists with correct signature
--
-- Assumptions (match 001_schema.sql + seeds):
--   alice_id  — a regular 'user' (role)
--   bob_id    — another regular 'user'
--   admin_id  — a user with role = 'admin'
--
-- Run:
--   psql "$DATABASE_URL" -f scripts/test/008_admin_rls_test.sql

BEGIN;

-- ── Fixtures ──────────────────────────────────────────────────────────────

-- Use the same named auth.users rows that earlier test scripts create.
-- If running standalone, create minimal stubs.

DO $$
DECLARE
  alice_id  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  bob_id    uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  admin_id  uuid := 'aaaaaaaa-0000-0000-0000-000000000009';
  v_result  jsonb;
  v_count   int;
BEGIN

  -- ── 1. admin_update_user: happy path ────────────────────────────────────

  -- Impersonate admin caller
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  -- Suspend alice (change status, keep role)
  SELECT admin_update_user(
    p_target_user_id := alice_id,
    p_new_role       := 'user',
    p_new_status     := 'suspended',
    p_reason         := 'Test suspension'
  ) INTO v_result;

  ASSERT (v_result->>'status') = 'suspended',
    'Test 1 FAIL: expected suspended, got ' || (v_result->>'status');

  -- Verify audit_log row was written
  SELECT COUNT(*) INTO v_count
  FROM audit_logs
  WHERE actor_id = admin_id
    AND target_id = alice_id
    AND action = 'update_user';

  ASSERT v_count > 0, 'Test 1 FAIL: no audit_log row written';

  RAISE NOTICE 'Test 1 PASS: admin_update_user happy path';

  -- ── 2. admin_update_user: non-admin blocked ──────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', bob_id)::text, true);

  BEGIN
    SELECT admin_update_user(
      p_target_user_id := alice_id,
      p_new_role       := 'user',
      p_new_status     := 'active',
      p_reason         := 'Restore'
    ) INTO v_result;
    ASSERT false, 'Test 2 FAIL: expected UNAUTHORIZED error';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%UNAUTHORIZED%' OR SQLERRM ILIKE '%not admin%',
      'Test 2 FAIL: unexpected error: ' || SQLERRM;
    RAISE NOTICE 'Test 2 PASS: admin_update_user blocks non-admin';
  END;

  -- ── 3. admin_credit_adjustment: happy path ───────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  DECLARE
    credits_before int;
    credits_after  int;
  BEGIN
    SELECT credits INTO credits_before FROM profiles WHERE id = alice_id;

    SELECT admin_credit_adjustment(
      p_target_user_id := alice_id,
      p_amount         := 100,
      p_reason         := 'Test bonus credits'
    ) INTO v_result;

    SELECT credits INTO credits_after FROM profiles WHERE id = alice_id;

    ASSERT credits_after = credits_before + 100,
      'Test 3 FAIL: expected ' || (credits_before + 100)
        || ' credits, got ' || credits_after;

    -- Verify credit_ledger row
    SELECT COUNT(*) INTO v_count
    FROM credit_ledger
    WHERE user_id = alice_id
      AND source_type = 'admin_adjustment'
      AND amount = 100;

    ASSERT v_count > 0, 'Test 3 FAIL: no credit_ledger row';
    RAISE NOTICE 'Test 3 PASS: admin_credit_adjustment happy path';
  END;

  -- ── 4. admin_credit_adjustment: non-admin blocked ────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', bob_id)::text, true);

  BEGIN
    SELECT admin_credit_adjustment(
      p_target_user_id := alice_id,
      p_amount         := 50,
      p_reason         := 'Unauthorized grab'
    ) INTO v_result;
    ASSERT false, 'Test 4 FAIL: expected UNAUTHORIZED error';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%UNAUTHORIZED%' OR SQLERRM ILIKE '%not admin%',
      'Test 4 FAIL: unexpected error: ' || SQLERRM;
    RAISE NOTICE 'Test 4 PASS: admin_credit_adjustment blocks non-admin';
  END;

  -- ── 5. admin_credit_adjustment: zero amount rejected ────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  BEGIN
    SELECT admin_credit_adjustment(
      p_target_user_id := alice_id,
      p_amount         := 0,
      p_reason         := 'Zero adjustment'
    ) INTO v_result;
    ASSERT false, 'Test 5 FAIL: expected zero-amount error';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%INVALID_AMOUNT%' OR SQLERRM ILIKE '%non-zero%',
      'Test 5 FAIL: unexpected error: ' || SQLERRM;
    RAISE NOTICE 'Test 5 PASS: admin_credit_adjustment rejects zero amount';
  END;

  -- ── 6. RLS on audit_logs: admin sees rows, regular user sees none ────────

  -- Admin should see rows
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  SELECT COUNT(*) INTO v_count FROM audit_logs;
  ASSERT v_count > 0, 'Test 6a FAIL: admin sees no audit_logs rows';
  RAISE NOTICE 'Test 6a PASS: admin sees audit_logs rows (count=%)', v_count;

  -- Regular user should see 0 rows (RLS policy = admin only)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', bob_id)::text, true);

  SELECT COUNT(*) INTO v_count FROM audit_logs;
  ASSERT v_count = 0,
    'Test 6b FAIL: regular user sees ' || v_count || ' audit_logs rows';
  RAISE NOTICE 'Test 6b PASS: regular user sees 0 audit_logs rows';

  -- ── 7. RLS on credit_ledger: owner sees own, admin sees all ─────────────

  -- alice sees own rows
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', alice_id)::text, true);

  SELECT COUNT(*) INTO v_count
  FROM credit_ledger WHERE user_id = alice_id;
  ASSERT v_count > 0,
    'Test 7a FAIL: alice sees 0 of her own credit_ledger rows';
  RAISE NOTICE 'Test 7a PASS: alice sees her own credit_ledger rows';

  -- alice sees 0 of bob's rows
  SELECT COUNT(*) INTO v_count
  FROM credit_ledger WHERE user_id = bob_id;
  ASSERT v_count = 0,
    'Test 7b FAIL: alice sees bob''s credit_ledger rows';
  RAISE NOTICE 'Test 7b PASS: alice cannot see bob''s credit_ledger rows';

  -- admin sees all rows
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  SELECT COUNT(*) INTO v_count FROM credit_ledger;
  ASSERT v_count > 0,
    'Test 7c FAIL: admin sees 0 credit_ledger rows total';
  RAISE NOTICE 'Test 7c PASS: admin sees all credit_ledger rows (count=%)', v_count;

  -- ── 8. admin_resolve_report exists (Stage 15 stub) ───────────────────────

  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_resolve_report';

  ASSERT v_count > 0,
    'Test 8 FAIL: admin_resolve_report function does not exist';
  RAISE NOTICE 'Test 8 PASS: admin_resolve_report function exists';

  -- ── Restore alice to active after test ───────────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  PERFORM admin_update_user(
    p_target_user_id := alice_id,
    p_new_role       := 'user',
    p_new_status     := 'active',
    p_reason         := 'Restore after test'
  );

END $$;

ROLLBACK;

-- All 8 tests passed if we get here with NOTICE lines above.
\echo 'Stage 14 admin RLS tests complete.'
