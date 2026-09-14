BEGIN;

-- Exchange economy integration test.
-- Uses existing user/admin accounts only, but does NOT require clean users.
-- All test writes happen inside this transaction and are rolled back at the end.
-- Run in Supabase SQL Editor as database owner/admin.
-- Requirements: at least 2 ordinary users and 1 admin.

DO $$
DECLARE
  v_u1 uuid;
  v_u2 uuid;
  v_admin uuid;
  v_task uuid;
  v_task2 uuid;
  v_promo uuid;
  v_reward integer;
  v_before integer;
  v_after integer;
  v_before_remaining integer;
  v_after_remaining integer;
  v_err text;
  v_count integer;
  v_ledger_before integer;
  v_ledger_after integer;
  v_balance_before integer;
  v_balance_after integer;
  v_difference_before integer;
  v_difference_after integer;
BEGIN
  --------------------------------------------------------------------
  -- TEST ACCOUNT SETUP
  -- Do not require users to have a clean history. We normalize the
  -- completion timestamps inside the transaction for rate-limit tests.
  --------------------------------------------------------------------

  SELECT id INTO v_u1
  FROM public.profiles
  WHERE role='user'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_u2
  FROM public.profiles
  WHERE role='user' AND id<>v_u1
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role='admin'
  ORDER BY created_at
  LIMIT 1;

  IF v_u1 IS NULL OR v_u2 IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: need at least 2 users and 1 admin';
  END IF;

  --------------------------------------------------------------------
  -- 0. Baseline ledger state
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_u1::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_before,v_ledger_before,v_difference_before
  FROM public.credit_ledger_check(v_u1);

  IF v_difference_before IS NULL THEN
    RAISE EXCEPTION 'FAIL: baseline ledger check returned NULL';
  END IF;

  --------------------------------------------------------------------
  -- 1. STARTER TASK -> CREDITS + TRANSACTION
  --------------------------------------------------------------------

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  VALUES(
    v_u1,
    'Instagram',
    'Follow',
    'https://www.instagram.com/example/',
    'TEST starter reward',
    'Starter',
    7,
    'active'
  )
  RETURNING id,reward INTO v_task,v_reward;

  SELECT credits INTO v_before
  FROM public.profiles
  WHERE id=v_u1;

  IF public.complete_task(v_task)<>v_reward THEN
    RAISE EXCEPTION 'FAIL: task reward return';
  END IF;

  SELECT credits INTO v_after
  FROM public.profiles
  WHERE id=v_u1;

  IF v_after<>v_before+v_reward THEN
    RAISE EXCEPTION 'FAIL: credits did not increase';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.task_completion_id IN(
      SELECT id
      FROM public.task_completions
      WHERE task_id=v_task AND user_id=v_u1
    )
      AND ct.amount=v_reward
      AND ct.type='task_reward'
  ) THEN
    RAISE EXCEPTION 'FAIL: reward transaction missing';
  END IF;

  --------------------------------------------------------------------
  -- 2. DUPLICATE REWARD BLOCKED
  --------------------------------------------------------------------

  v_err:=NULL;
  BEGIN
    PERFORM public.complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_err:=SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT ILIKE '%already completed%' THEN
    RAISE EXCEPTION
      'FAIL: duplicate completion not blocked: %',
      COALESCE(v_err,'no error');
  END IF;

  --------------------------------------------------------------------
  -- 3. OWN NON-STARTER TASK BLOCKED
  --------------------------------------------------------------------

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  VALUES(
    v_u1,
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-own/',
    'TEST own task',
    'Promotion',
    3,
    'active'
  )
  RETURNING id INTO v_task2;

  v_err:=NULL;
  BEGIN
    PERFORM public.complete_task(v_task2);
  EXCEPTION WHEN OTHERS THEN
    v_err:=SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT ILIKE '%own task%' THEN
    RAISE EXCEPTION
      'FAIL: self completion not blocked: %',
      COALESCE(v_err,'no error');
  END IF;

  --------------------------------------------------------------------
  -- 4. PROMOTION BUDGET DECREMENT + EXHAUSTION
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.admin_adjust_credits(v_u1,50,'test setup');

  PERFORM set_config('request.jwt.claim.sub',v_u1::text,true);

  INSERT INTO public.social_profiles(
    user_id,platform,handle,url,active
  )
  VALUES(
    v_u1,
    'Instagram',
    'test-economy',
    'https://www.instagram.com/test-economy/',
    true
  )
  RETURNING id INTO v_task2;

  v_promo:=public.create_promotion(
    v_task2,
    'TEST budget',
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-budget/',
    10
  );

  SELECT remaining_budget,reward
  INTO v_before_remaining,v_reward
  FROM public.promotions
  WHERE id=v_promo;

  SELECT id INTO v_task
  FROM public.tasks
  WHERE promotion_id=v_promo;

  PERFORM set_config('request.jwt.claim.sub',v_u2::text,true);

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task,v_u2,'approved');

  PERFORM public.complete_task(v_task);

  SELECT remaining_budget,status
  INTO v_after_remaining,v_err
  FROM public.promotions
  WHERE id=v_promo;

  IF v_after_remaining<>v_before_remaining-v_reward THEN
    RAISE EXCEPTION 'FAIL: budget did not decrement';
  END IF;

  IF v_after_remaining<>0 OR v_err<>'completed' THEN
    RAISE EXCEPTION 'FAIL: budget exhaustion did not complete promotion';
  END IF;

  SELECT status INTO v_err
  FROM public.tasks
  WHERE id=v_task;

  IF v_err<>'completed' THEN
    RAISE EXCEPTION 'FAIL: exhausted promotion task not completed';
  END IF;

  --------------------------------------------------------------------
  -- 5. VERIFICATION: PENDING -> REJECTED -> APPROVED
  --------------------------------------------------------------------

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  VALUES(
    v_u1,
    'Instagram',
    'Follow',
    'https://www.instagram.com/verify-test/',
    'TEST verification',
    'Promotion',
    2,
    'active'
  )
  RETURNING id INTO v_task;

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task,v_u2,'pending');

  v_err:=NULL;
  BEGIN
    PERFORM public.complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_err:=SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT ILIKE '%pending%' THEN
    RAISE EXCEPTION
      'FAIL: pending verification not blocked: %',
      COALESCE(v_err,'no error');
  END IF;

  UPDATE public.task_verifications
  SET status='rejected'
  WHERE task_id=v_task AND user_id=v_u2;

  v_err:=NULL;
  BEGIN
    PERFORM public.complete_task(v_task);
  EXCEPTION WHEN OTHERS THEN
    v_err:=SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT ILIKE '%rejected%' THEN
    RAISE EXCEPTION
      'FAIL: rejected verification not blocked: %',
      COALESCE(v_err,'no error');
  END IF;

  UPDATE public.task_verifications
  SET status='approved'
  WHERE task_id=v_task AND user_id=v_u2;

  IF public.complete_task(v_task)<>2 THEN
    RAISE EXCEPTION 'FAIL: approved verification did not pay';
  END IF;

  --------------------------------------------------------------------
  -- 6. CANCELLATION -> REFUND
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_u1::text,true);

  v_promo:=public.create_promotion(
    v_task2,
    'TEST cancel',
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-cancel/',
    10
  );

  SELECT credits INTO v_before
  FROM public.profiles
  WHERE id=v_u1;

  IF public.cancel_promotion(v_promo)<>10 THEN
    RAISE EXCEPTION 'FAIL: cancellation refund amount';
  END IF;

  SELECT credits INTO v_after
  FROM public.profiles
  WHERE id=v_u1;

  IF v_after<>v_before+10 THEN
    RAISE EXCEPTION 'FAIL: cancellation did not refund credits';
  END IF;

  --------------------------------------------------------------------
  -- 7. ADMIN TASK DELETION -> REFUND
  --------------------------------------------------------------------

  v_promo:=public.create_promotion(
    v_task2,
    'TEST admin delete',
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-admin-delete/',
    10
  );

  SELECT user_id,remaining_budget
  INTO v_task2,v_before_remaining
  FROM public.promotions
  WHERE id=v_promo;

  SELECT id INTO v_task
  FROM public.tasks
  WHERE promotion_id=v_promo
  LIMIT 1;

  SELECT credits INTO v_before
  FROM public.profiles
  WHERE id=v_task2;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.admin_delete_task(v_task);

  SELECT credits INTO v_after
  FROM public.profiles
  WHERE id=v_task2;

  IF v_after<>v_before+v_before_remaining THEN
    RAISE EXCEPTION
      'FAIL: admin deletion did not refund remaining budget';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.promotions
    WHERE id=v_promo AND status<>'cancelled'
  ) THEN
    RAISE EXCEPTION
      'FAIL: admin deletion did not cancel promotion';
  END IF;

  --------------------------------------------------------------------
  -- 8. 30 TASKS / MINUTE
  -- Move this test user's pre-existing completions outside the minute
  -- window inside the transaction, then prove 31st completion is blocked.
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_u2::text,true);

  UPDATE public.task_completions
  SET completed_at=now()-interval '2 minutes'
  WHERE user_id=v_u2;

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  SELECT
    v_u2,
    'Instagram',
    'Follow',
    'https://www.instagram.com/rate-'||g||'/',
    'RATE '||g,
    'Starter',
    1,
    'active'
  FROM generate_series(1,31) g;

  v_count:=0;

  FOR v_task IN
    SELECT id
    FROM public.tasks
    WHERE owner_id=v_u2
      AND title LIKE 'RATE %'
    ORDER BY id
  LOOP
    v_count:=v_count+1;
    v_err:=NULL;

    BEGIN
      PERFORM public.complete_task(v_task);
    EXCEPTION WHEN OTHERS THEN
      v_err:=SQLERRM;
    END;

    IF v_count<=30 AND v_err IS NOT NULL THEN
      RAISE EXCEPTION
        'FAIL: completion % unexpectedly blocked: %',
        v_count,v_err;
    END IF;

    IF v_count=31 AND (
      v_err IS NULL
      OR v_err NOT ILIKE '%Too many task completions%'
    ) THEN
      RAISE EXCEPTION
        'FAIL: 31st/minute limit did not fire: %',
        COALESCE(v_err,'no error');
    END IF;
  END LOOP;

  --------------------------------------------------------------------
  -- 9. 300 TASKS / DAY
  -- Start with zero daily completions for this test user inside the
  -- transaction. Every 30 successful completions are moved outside the
  -- one-minute window, while remaining within today, so the daily count
  -- reaches 300 and the 301st is rejected.
  --------------------------------------------------------------------

  UPDATE public.task_completions
  SET completed_at=now()-interval '2 days'
  WHERE user_id=v_u2;

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  SELECT
    v_u2,
    'Instagram',
    'Follow',
    'https://www.instagram.com/day-'||g||'/',
    'DAY '||g,
    'Starter',
    1,
    'active'
  FROM generate_series(1,301) g;

  v_count:=0;

  FOR v_task IN
    SELECT id
    FROM public.tasks
    WHERE owner_id=v_u2
      AND title LIKE 'DAY %'
    ORDER BY id
  LOOP
    v_count:=v_count+1;

    IF v_count>1 AND mod(v_count-1,30)=0 THEN
      UPDATE public.task_completions
      SET completed_at=now()-interval '2 minutes'
      WHERE user_id=v_u2
        AND task_id IN(
          SELECT id
          FROM public.tasks
          WHERE owner_id=v_u2
            AND title LIKE 'DAY %'
        )
        AND completed_at>=date_trunc('day',now());
    END IF;

    v_err:=NULL;

    BEGIN
      PERFORM public.complete_task(v_task);
    EXCEPTION WHEN OTHERS THEN
      v_err:=SQLERRM;
    END;

    IF v_count<=300 AND v_err IS NOT NULL THEN
      RAISE EXCEPTION
        'FAIL: day completion % unexpectedly blocked: %',
        v_count,v_err;
    END IF;

    IF v_count=301 AND (
      v_err IS NULL
      OR v_err NOT ILIKE '%Daily task completion limit%'
    ) THEN
      RAISE EXCEPTION
        'FAIL: 301st/day limit did not fire: %',
        COALESCE(v_err,'no error');
    END IF;
  END LOOP;

  --------------------------------------------------------------------
  -- 10. FINAL LEDGER CONSISTENCY
  -- The pre-existing ledger difference must remain unchanged by the
  -- balanced test operations. This avoids assuming old account history
  -- was created by this test.
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_u1::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_after,v_ledger_after,v_difference_after
  FROM public.credit_ledger_check(v_u1);

  IF v_difference_after<>v_difference_before THEN
    RAISE EXCEPTION
      'FAIL: ledger difference changed from % to %',
      v_difference_before,v_difference_after;
  END IF;

  IF v_balance_after-v_balance_before
     <> v_ledger_after-v_ledger_before THEN
    RAISE EXCEPTION
      'FAIL: profile balance delta does not match ledger delta';
  END IF;

  RAISE NOTICE 'ALL ECONOMY TESTS PASSED';
END;
$$;

ROLLBACK;
