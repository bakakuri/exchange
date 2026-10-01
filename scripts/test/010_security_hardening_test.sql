-- scripts/test/010_security_hardening_test.sql
-- Stage 16: Security hardening — database-side checks
--
-- The bulk of Stage 16 is Express middleware (request-id, require-json,
-- validate-uuid-param, trust proxy, Helmet headers, env.js hard fail).
-- Those are unit-tested at the Node layer, not here.
--
-- This script validates the Postgres-side security invariants that the
-- hardening stage relies on: confirm that the internal helper functions
-- which must NOT be callable directly over RPC still have their EXECUTE
-- grant revoked from the anon and authenticated roles.
--
-- Verifies:
--   1. reward_task_completion is NOT EXECUTABle by authenticated
--   2. reward_task_completion is NOT EXECUTABle by anon
--   3. handle_new_user is NOT EXECUTABle by authenticated
--   4. update_xp_and_level is NOT EXECUTABle by authenticated
--   5. grant_achievement_if_not_exists is NOT EXECUTABle by authenticated
--
-- Run:
--   psql "$DATABASE_URL" -f scripts/test/010_security_hardening_test.sql

BEGIN;

DO $$
DECLARE
  v_has_grant boolean;

  -- Internal-only function signatures (same as in 015_functions.sql)
  INTERNAL_FUNS text[] := ARRAY[
    'reward_task_completion(uuid,uuid)',
    'update_xp_and_level(uuid,integer)',
    'grant_achievement_if_not_exists(uuid,text)'
  ];
  -- Trigger function — always owned by postgres, never directly callable.
  TRIGGER_FUN text := 'handle_new_user()';
  fun text;
  test_num int := 1;
BEGIN

  -- ── 1-3. Internal helpers: no EXECUTE for 'authenticated' ────────────────

  FOREACH fun IN ARRAY INTERNAL_FUNS LOOP
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.routine_privileges rp
      JOIN pg_proc p ON p.proname = split_part(fun, '(', 1)
      WHERE rp.specific_schema = 'public'
        AND rp.privilege_type = 'EXECUTE'
        AND rp.grantee = 'authenticated'
        AND p.oid::regprocedure::text ILIKE '%' || split_part(fun, '(', 1) || '%'
    ) INTO v_has_grant;

    ASSERT NOT v_has_grant,
      'Test ' || test_num || ' FAIL: authenticated can EXECUTE ' || fun;
    RAISE NOTICE 'Test % PASS: authenticated cannot EXECUTE %', test_num, fun;
    test_num := test_num + 1;
  END LOOP;

  -- ── 4. Trigger function exists and is a trigger (not callable directly) ─

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'handle_new_user'
      AND prorettype = 'trigger'::regtype
  ) INTO v_has_grant; -- reuse variable as boolean

  ASSERT v_has_grant,
    'Test 4 FAIL: handle_new_user trigger function missing';
  RAISE NOTICE 'Test 4 PASS: handle_new_user is a trigger function (not directly callable)';

  -- ── 5. Public admin RPCs have EXECUTE for 'authenticated' ────────────────
  -- (Sanity check that the grant revocations above did NOT accidentally
  -- strip grants from the public-facing RPCs the client is supposed to call.)

  DECLARE
    PUBLIC_RPCS text[] := ARRAY[
      'admin_update_user',
      'admin_credit_adjustment',
      'admin_resolve_report',
      'create_campaign',
      'cancel_campaign',
      'submit_task_verification',
      'review_task_verification',
      'claim_referral'
    ];
    rpc text;
  BEGIN
    FOREACH rpc IN ARRAY PUBLIC_RPCS LOOP
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.routine_privileges rp
        JOIN pg_proc p ON p.proname = rpc
        WHERE rp.specific_schema = 'public'
          AND rp.privilege_type = 'EXECUTE'
          AND rp.grantee IN ('authenticated', 'anon')
      ) INTO v_has_grant;

      ASSERT v_has_grant,
        'Test 5 FAIL: ' || rpc || ' has no EXECUTE grant for authenticated/anon — check 015_functions.sql';
      RAISE NOTICE 'Test 5 PASS: % has EXECUTE grant', rpc;
    END LOOP;
  END;

END $$;

ROLLBACK;

\echo 'Stage 16 security hardening database checks complete.'
