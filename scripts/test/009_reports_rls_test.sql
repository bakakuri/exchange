-- scripts/test/009_reports_rls_test.sql
-- Stage 15: Reports & moderation — local validation tests
--
-- Verifies:
--   1. User can submit a report (INSERT)
--   2. Reporter sees own report via RLS
--   3. Non-reporter sees 0 reports via RLS
--   4. Admin sees all reports via RLS
--   5. admin_resolve_report resolves an open report
--   6. admin_resolve_report dismisses an open report
--   7. admin_resolve_report blocks non-admin caller
--   8. admin_resolve_report rejects unknown report id (NOT_FOUND)
--   9. admin_resolve_report rejects invalid decision (VALIDATION_ERROR)
--
-- Assumptions (same auth.users from earlier test scripts):
--   alice_id  — regular user
--   bob_id    — regular user (outsider)
--   admin_id  — role = 'admin'
--
-- Run:
--   psql "$DATABASE_URL" -f scripts/test/009_reports_rls_test.sql

BEGIN;

DO $$
DECLARE
  alice_id  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  bob_id    uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  admin_id  uuid := 'aaaaaaaa-0000-0000-0000-000000000009';
  -- Use a dummy task UUID (FK won't be validated in the local stub).
  dummy_task_id uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_report_id   uuid;
  v_count       int;
  v_status      text;
BEGIN

  -- ── 1. User can submit a report ──────────────────────────────────────────

  -- Server-side INSERT uses supabaseAdmin with explicit reporter_id.
  -- In the local stub we simulate that by inserting as postgres superuser.
  INSERT INTO public.reports (reporter_id, report_type, description, related_task_id)
  VALUES (alice_id, 'spam', 'This task is spam — test report', dummy_task_id)
  RETURNING id INTO v_report_id;

  ASSERT v_report_id IS NOT NULL, 'Test 1 FAIL: insert returned no id';
  RAISE NOTICE 'Test 1 PASS: report inserted (id=%)', v_report_id;

  -- ── 2. Reporter sees own report ───────────────────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', alice_id)::text, true);

  SELECT COUNT(*) INTO v_count FROM public.reports WHERE id = v_report_id;
  ASSERT v_count = 1, 'Test 2 FAIL: alice should see her own report';
  RAISE NOTICE 'Test 2 PASS: alice sees her own report';

  -- ── 3. Non-reporter sees 0 reports ───────────────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', bob_id)::text, true);

  SELECT COUNT(*) INTO v_count FROM public.reports;
  ASSERT v_count = 0, 'Test 3 FAIL: bob should see 0 reports, got ' || v_count;
  RAISE NOTICE 'Test 3 PASS: bob sees 0 reports';

  -- ── 4. Admin sees all reports ─────────────────────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  SELECT COUNT(*) INTO v_count FROM public.reports;
  ASSERT v_count > 0, 'Test 4 FAIL: admin sees 0 reports';
  RAISE NOTICE 'Test 4 PASS: admin sees all reports (count=%)', v_count;

  -- ── 5. admin_resolve_report: resolve ─────────────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  -- Insert a second report to resolve.
  INSERT INTO public.reports (reporter_id, report_type, description, related_task_id)
  VALUES (alice_id, 'fraud', 'Fraudulent task — test for resolution', dummy_task_id)
  RETURNING id INTO v_report_id;

  PERFORM public.admin_resolve_report(v_report_id, 'resolved', 'Confirmed spam');

  SELECT status::text INTO v_status FROM public.reports WHERE id = v_report_id;
  ASSERT v_status = 'resolved',
    'Test 5 FAIL: expected resolved, got ' || v_status;
  RAISE NOTICE 'Test 5 PASS: admin_resolve_report → resolved';

  -- ── 6. admin_resolve_report: dismiss ─────────────────────────────────────

  INSERT INTO public.reports (reporter_id, report_type, description, related_task_id)
  VALUES (alice_id, 'broken_url', 'URL no longer works — test dismiss', dummy_task_id)
  RETURNING id INTO v_report_id;

  PERFORM public.admin_resolve_report(v_report_id, 'dismissed', 'False positive');

  SELECT status::text INTO v_status FROM public.reports WHERE id = v_report_id;
  ASSERT v_status = 'dismissed',
    'Test 6 FAIL: expected dismissed, got ' || v_status;
  RAISE NOTICE 'Test 6 PASS: admin_resolve_report → dismissed';

  -- ── 7. admin_resolve_report: non-admin blocked ───────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', bob_id)::text, true);

  INSERT INTO public.reports (reporter_id, report_type, description, related_task_id)
  VALUES (alice_id, 'abuse', 'Abuse test', dummy_task_id)
  RETURNING id INTO v_report_id;

  BEGIN
    PERFORM public.admin_resolve_report(v_report_id, 'resolved', '');
    ASSERT false, 'Test 7 FAIL: expected FORBIDDEN error';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%FORBIDDEN%' OR SQLERRM ILIKE '%admin%',
      'Test 7 FAIL: unexpected error: ' || SQLERRM;
    RAISE NOTICE 'Test 7 PASS: admin_resolve_report blocks non-admin';
  END;

  -- ── 8. admin_resolve_report: unknown report id ────────────────────────────

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_id)::text, true);

  BEGIN
    PERFORM public.admin_resolve_report(
      gen_random_uuid(),  -- non-existent
      'resolved',
      'Should not exist'
    );
    ASSERT false, 'Test 8 FAIL: expected NOT_FOUND error';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%NOT_FOUND%',
      'Test 8 FAIL: unexpected error: ' || SQLERRM;
    RAISE NOTICE 'Test 8 PASS: admin_resolve_report → NOT_FOUND for unknown id';
  END;

  -- ── 9. admin_resolve_report: invalid decision ────────────────────────────

  INSERT INTO public.reports (reporter_id, report_type, description, related_task_id)
  VALUES (alice_id, 'spam', 'Another test report', dummy_task_id)
  RETURNING id INTO v_report_id;

  BEGIN
    PERFORM public.admin_resolve_report(v_report_id, 'deleted', 'Bad decision');
    ASSERT false, 'Test 9 FAIL: expected VALIDATION_ERROR';
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM ILIKE '%VALIDATION_ERROR%' OR SQLERRM ILIKE '%resolved or dismissed%',
      'Test 9 FAIL: unexpected error: ' || SQLERRM;
    RAISE NOTICE 'Test 9 PASS: admin_resolve_report rejects invalid decision';
  END;

END $$;

ROLLBACK;

\echo 'Stage 15 reports moderation tests complete.'
