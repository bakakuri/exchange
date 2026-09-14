BEGIN;

-- Exchange economy integration test.
-- Uses the existing database accounts and rolls everything back at the end.
-- Run in Supabase SQL Editor as database owner/admin.
-- Requirements: at least 1 ordinary user and 1 admin.
-- The admin is used as the second actor for cross-user task tests.

DO $$
DECLARE
  v_user uuid;
  v_admin uuid;
  v_task uuid;
  v_task2 uuid;
  v_promo uuid;
  v_social_profile uuid;
  v_reward integer;
  v_before integer;
  v_after integer;
  v_before_remaining integer;
  v_after_remaining integer;
  v_err text;
  v_count integer;
  v_balance_before integer;
  v_balance_after integer;
  v_ledger_before integer;
  v_ledger_after integer;
  v_difference_before integer;
  v_difference_after integer;
BEGIN
  --------------------------------------------------------------------
  -- TEST ACCOUNT SETUP
  --------------------------------------------------------------------

  SELECT id
  INTO v_user
  FROM public.profiles
  WHERE role='user'
  ORDER BY created_at
  LIMIT 1;

  SELECT id
  INTO v_admin
  FROM public.profiles
  WHERE role='admin'
  ORDER BY created_at
  LIMIT 1;

  IF v_user IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: need at least 1 user and 1 admin';
  END IF;

  --------------------------------------------------------------------
  -- 0. BASELINE LEDGER
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_before,v_ledger_before,v_difference_before
  FROM public.credit_ledger_check(v_user);

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
    v_user,
    'Instagram',
    'Follow',
    'https://www.instagram.com/example/',
    'TEST starter reward',
    'Starter',
    7,
    'active'
  )
  RETURNING id,reward INTO v_task,v_reward;

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  SELECT credits INTO v_before
  FROM public.profiles WHERE id=v_user;

  IF public.complete_task(v_task)<>v_reward THEN
    RAISE EXCEPTION 'FAIL: Starter task reward return';
  END IF;

  SELECT credits INTO v_after
  FROM public.profiles WHERE id=v_user;

  IF v_after<>v_before+v_reward THEN
    RAISE EXCEPTION 'FAIL: Starter task credits did not increase';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.task_completion_id IN(
      SELECT id FROM public.task_completions
      WHERE task_id=v_task AND user_id=v_user
    )
      AND ct.amount=v_reward
      AND ct.type='task_reward'
  ) THEN
    RAISE EXCEPTION 'FAIL: Starter reward transaction missing';
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
    v_user,
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
  -- create_promotion(10) means budget=10 but reward=1.
  -- Therefore one task cannot exhaust the promotion. We create ten
  -- linked tasks and let the admin complete them as the second actor.
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.admin_adjust_credits(v_user,50,'economy test setup');

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  INSERT INTO public.social_profiles(
    user_id,platform,handle,url,active
  )
  VALUES(
    v_user,
    'Instagram',
    'test-economy',
    'https://www.instagram.com/test-economy/',
    true
  )
  RETURNING id INTO v_social_profile;

  v_promo:=public.create_promotion(
    v_social_profile,
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

  -- create_promotion creates the first linked task. Add nine more so
  -- ten rewards of 1 credit consume the complete 10-credit budget.
  INSERT INTO public.tasks(
    owner_id,social_profile_id,promotion_id,platform,action,
    target_url,title,category,reward,status
  )
  SELECT
    v_user,
    v_social_profile,
    v_promo,
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-budget-'||g||'/',
    'TEST budget extra '||g,
    'Promotion',
    v_reward,
    'active'
  FROM generate_series(1,9) g;

  v_count:=0;

  FOR v_task IN
    SELECT id
    FROM public.tasks
    WHERE promotion_id=v_promo
    ORDER BY id
  LOOP
    v_count:=v_count+1;

    PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

    INSERT INTO public.task_verifications(task_id,user_id,status)
    VALUES(v_task,v_admin,'approved');

    IF public.complete_task(v_task)<>v_reward THEN
      RAISE EXCEPTION
        'FAIL: promotion task % reward return',v_count;
    END IF;

    SELECT remaining_budget,status
    INTO v_after_remaining,v_err
    FROM public.promotions
    WHERE id=v_promo;

    IF v_after_remaining<>v_before_remaining-(v_reward*v_count) THEN
      RAISE EXCEPTION
        'FAIL: promotion budget mismatch after task %: expected %, got %',
        v_count,
        v_before_remaining-(v_reward*v_count),
        v_after_remaining;
    END IF;

    IF v_count<10 AND v_err<>'active' THEN
      RAISE EXCEPTION
        'FAIL: promotion completed too early after task %',v_count;
    END IF;

    IF v_count=10 AND v_err<>'completed' THEN
      RAISE EXCEPTION
        'FAIL: budget exhaustion did not complete promotion';
    END IF;
  END LOOP;

  IF v_count<>10 THEN
    RAISE EXCEPTION
      'FAIL: expected 10 linked promotion tasks, got %',v_count;
  END IF;

  SELECT status INTO v_err
  FROM public.tasks
  WHERE promotion_id=v_promo
    AND id=v_task;

  IF v_err<>'completed' THEN
    RAISE EXCEPTION 'FAIL: exhausted promotion task not completed';
  END IF;

  --------------------------------------------------------------------
  -- 5. VERIFICATION: PENDING -> REJECTED -> APPROVED
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  VALUES(
    v_user,
    'Instagram',
    'Follow',
    'https://www.instagram.com/verify-test/',
    'TEST verification',
    'Promotion',
    2,
    'active'
  )
  RETURNING id INTO v_task;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task,v_admin,'pending');

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
  WHERE task_id=v_task AND user_id=v_admin;

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
  WHERE task_id=v_task AND user_id=v_admin;

  IF public.complete_task(v_task)<>2 THEN
    RAISE EXCEPTION 'FAIL: approved verification did not pay';
  END IF;

  --------------------------------------------------------------------
  -- 6. CANCELLATION -> FULL UNUSED BUDGET REFUND
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  v_promo:=public.create_promotion(
    v_social_profile,
    'TEST cancel',
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-cancel/',
    10
  );

  SELECT credits INTO v_before
  FROM public.profiles WHERE id=v_user;

  IF public.cancel_promotion(v_promo)<>10 THEN
    RAISE EXCEPTION 'FAIL: cancellation refund amount';
  END IF;

  SELECT credits INTO v_after
  FROM public.profiles WHERE id=v_user;

  IF v_after<>v_before+10 THEN
    RAISE EXCEPTION 'FAIL: cancellation did not refund credits';
  END IF;

  --------------------------------------------------------------------
  -- 7. ADMIN TASK DELETION -> REMAINING BUDGET REFUND
  --------------------------------------------------------------------

  v_promo:=public.create_promotion(
    v_social_profile,
    'TEST admin delete',
    'Instagram',
    'Follow',
    'https://www.instagram.com/example-admin-delete/',
    10
  );

  SELECT user_id,remaining_budget
  INTO v_user,v_before_remaining
  FROM public.promotions
  WHERE id=v_promo;

  SELECT id INTO v_task
  FROM public.tasks
  WHERE promotion_id=v_promo
  LIMIT 1;

  SELECT credits INTO v_before
  FROM public.profiles WHERE id=v_user;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  PERFORM public.admin_delete_task(v_task);

  SELECT credits INTO v_after
  FROM public.profiles WHERE id=v_user;

  IF v_after<>v_before+v_before_remaining THEN
    RAISE EXCEPTION
      'FAIL: admin deletion did not refund remaining budget';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.promotions
    WHERE id=v_promo AND status<>'cancelled'
  ) THEN
    RAISE EXCEPTION
      'FAIL: admin deletion did not cancel promotion';
  END IF;

  --------------------------------------------------------------------
  -- 8. LEDGER DELTA CONSISTENCY
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_after,v_ledger_after,v_difference_after
  FROM public.credit_ledger_check(v_user);

  IF v_difference_after<>v_difference_before THEN
    RAISE EXCEPTION
      'FAIL: ledger difference changed from % to %',
      v_difference_before,v_difference_after;
  END IF;

  --------------------------------------------------------------------
  -- 9. 30 TASKS / MINUTE
  --------------------------------------------------------------------

  UPDATE public.task_completions
  SET completed_at=now()-interval '2 minutes'
  WHERE user_id=v_admin;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  SELECT
    v_user,
    'Instagram',
    'Follow',
    'https://www.instagram.com/rate-'||g||'/',
    'RATE '||g,
    'Promotion',
    1,
    'active'
  FROM generate_series(1,31) g;

  v_count:=0;

  FOR v_task IN
    SELECT id
    FROM public.tasks
    WHERE owner_id=v_user
      AND title LIKE 'RATE %'
    ORDER BY id
  LOOP
    v_count:=v_count+1;
    v_err:=NULL;

    BEGIN
      INSERT INTO public.task_verifications(task_id,user_id,status)
      VALUES(v_task,v_admin,'approved');

      PERFORM public.complete_task(v_task);
    EXCEPTION WHEN OTHERS THEN
      v_err:=SQLERRM;
    END;

    IF v_count<=30 AND v_err IS NOT NULL THEN
      RAISE EXCEPTION
        'FAIL: completion % unexpectedly blocked: %',
        v_count,v_err;
    END IF;

    IF v_count=31
       AND (v_err IS NULL OR v_err NOT ILIKE '%Too many task completions%') THEN
      RAISE EXCEPTION
        'FAIL: 31st/minute limit did not fire: %',
        COALESCE(v_err,'no error');
    END IF;
  END LOOP;

  --------------------------------------------------------------------
  -- 10. 300 TASKS / DAY
  --------------------------------------------------------------------

  UPDATE public.task_completions
  SET completed_at=date_trunc('day',now())-interval '1 second'
  WHERE user_id=v_admin;

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  SELECT
    v_user,
    'Instagram',
    'Follow',
    'https://www.instagram.com/day-'||g||'/',
    'DAY '||g,
    'Promotion',
    1,
    'active'
  FROM generate_series(1,301) g;

  v_count:=0;

  FOR v_task IN
    SELECT id
    FROM public.tasks
    WHERE owner_id=v_user
      AND title LIKE 'DAY %'
    ORDER BY id
  LOOP
    v_count:=v_count+1;
    v_err:=NULL;

    BEGIN
      INSERT INTO public.task_verifications(task_id,user_id,status)
      VALUES(v_task,v_admin,'approved');

      PERFORM public.complete_task(v_task);
    EXCEPTION WHEN OTHERS THEN
      v_err:=SQLERRM;
    END;

    IF v_count<=300 AND v_err IS NOT NULL THEN
      RAISE EXCEPTION
        'FAIL: day completion % unexpectedly blocked: %',
        v_count,v_err;
    END IF;

    IF v_count=301
       AND (v_err IS NULL OR v_err NOT ILIKE '%Daily task completion limit%') THEN
      RAISE EXCEPTION
        'FAIL: 301st/day limit did not fire: %',
        COALESCE(v_err,'no error');
    END IF;
  END LOOP;

  --------------------------------------------------------------------
  -- FINAL LEDGER CHECK
  --------------------------------------------------------------------

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_after,v_ledger_after,v_difference_after
  FROM public.credit_ledger_check(v_user);

  IF v_difference_after<>v_difference_before THEN
    RAISE EXCEPTION
      'FAIL: final ledger difference changed from % to %',
      v_difference_before,v_difference_after;
  END IF;

  RAISE NOTICE 'ALL ECONOMY TESTS PASSED';
END;
$$;

ROLLBACK;
