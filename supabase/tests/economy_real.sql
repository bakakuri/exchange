BEGIN;

-- Exchange economy integration test.
-- Requires only 1 normal user and 1 admin.
-- All writes are rolled back at the end.
-- Run in Supabase SQL Editor as database owner/admin.
--
-- IMPORTANT:
-- The rate-limit tests deliberately seed historical completion rows inside
-- this transaction. This avoids making the 300/day test depend on wall-clock
-- timing or accidentally tripping the 30/minute limit.

DO $$
DECLARE
  v_user uuid;
  v_admin uuid;
  v_task uuid;
  v_task2 uuid;
  v_completion uuid;
  v_promo uuid;
  v_social_profile uuid;
  v_reward integer;
  v_before integer;
  v_after integer;
  v_remaining_before integer;
  v_remaining_after integer;
  v_status text;
  v_err text;
  v_count integer;
  v_balance_before integer;
  v_balance_after integer;
  v_ledger_before integer;
  v_ledger_after integer;
  v_difference_before integer;
  v_difference_after integer;
BEGIN
  ------------------------------------------------------------------
  -- SETUP
  ------------------------------------------------------------------
  SELECT id INTO v_user
  FROM public.profiles
  WHERE role='user'
  ORDER BY created_at
  LIMIT 1;

  SELECT id INTO v_admin
  FROM public.profiles
  WHERE role='admin'
  ORDER BY created_at
  LIMIT 1;

  IF v_user IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: need at least 1 user and 1 admin';
  END IF;

  -- Make the actors independent of existing rate/daily history.
  UPDATE public.task_completions
  SET completed_at=date_trunc('day',now())-interval '1 second'
  WHERE user_id IN (v_user,v_admin);

  ------------------------------------------------------------------
  -- 0. BASELINE LEDGER
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_before,v_ledger_before,v_difference_before
  FROM public.credit_ledger_check(v_user);

  IF v_difference_before IS NULL THEN
    RAISE EXCEPTION 'FAIL: baseline ledger difference is NULL';
  END IF;

  ------------------------------------------------------------------
  -- 1. STARTER TASK -> CREDITS + TRANSACTION
  ------------------------------------------------------------------
  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/example-starter/',
    'TEST starter','Starter',7,'active'
  ) RETURNING id,reward INTO v_task,v_reward;

  SELECT credits INTO v_before
  FROM public.profiles WHERE id=v_user;

  IF public.complete_task(v_task)<>v_reward THEN
    RAISE EXCEPTION 'FAIL: Starter task reward return';
  END IF;

  SELECT credits INTO v_after
  FROM public.profiles WHERE id=v_user;

  IF v_after<>v_before+v_reward THEN
    RAISE EXCEPTION 'FAIL: Starter task did not add credits';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.credit_transactions ct
    WHERE ct.task_completion_id IN(
      SELECT id FROM public.task_completions
      WHERE task_id=v_task AND user_id=v_user
    )
    AND ct.amount=v_reward
    AND ct.type='task_reward'
  ) THEN
    RAISE EXCEPTION 'FAIL: Starter reward transaction missing';
  END IF;

  ------------------------------------------------------------------
  -- 2. DUPLICATE REWARD BLOCK
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- 3. OWN NON-STARTER TASK BLOCK
  ------------------------------------------------------------------
  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/example-own/',
    'TEST own task','Promotion',3,'active'
  ) RETURNING id INTO v_task2;

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

  ------------------------------------------------------------------
  -- TEST CREDIT BUDGET
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.admin_adjust_credits(
    v_user,1000,'economy integration test setup'
  );

  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  INSERT INTO public.social_profiles(
    user_id,platform,handle,url,active
  ) VALUES(
    v_user,'Instagram',
    'test-economy-'||replace(gen_random_uuid()::text,'-',''),
    'https://www.instagram.com/test-economy/',true
  ) RETURNING id INTO v_social_profile;

  ------------------------------------------------------------------
  -- 4. PROMOTION BUDGET DECREMENT + EXHAUSTION
  -- 10 credits / reward 1 = exactly 10 completions.
  ------------------------------------------------------------------
  v_promo:=public.create_promotion(
    v_social_profile,'TEST budget','Instagram','Follow',
    'https://www.instagram.com/example-budget/',10
  );

  SELECT remaining_budget,reward
  INTO v_remaining_before,v_reward
  FROM public.promotions WHERE id=v_promo;

  IF v_remaining_before<>10 OR v_reward<>1 THEN
    RAISE EXCEPTION
      'FAIL: unexpected promotion setup: budget %, reward %',
      v_remaining_before,v_reward;
  END IF;

  SELECT id INTO v_task
  FROM public.tasks
  WHERE promotion_id=v_promo
  ORDER BY created_at,id
  LIMIT 1;

  INSERT INTO public.tasks(
    owner_id,social_profile_id,promotion_id,platform,action,
    target_url,title,category,reward,status
  )
  SELECT
    v_user,v_social_profile,v_promo,'Instagram','Follow',
    'https://www.instagram.com/budget-'||g||'/',
    'TEST budget '||g,'Promotion',1,'active'
  FROM generate_series(1,9) g;

  -- Keep the admin outside the minute limit.
  UPDATE public.task_completions
  SET completed_at=now()-interval '2 minutes'
  WHERE user_id=v_admin;

  FOR v_task IN
    SELECT id FROM public.tasks
    WHERE promotion_id=v_promo
    ORDER BY created_at,id
  LOOP
    PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

    INSERT INTO public.task_verifications(task_id,user_id,status)
    VALUES(v_task,v_admin,'approved');

    IF public.complete_task(v_task)<>1 THEN
      RAISE EXCEPTION 'FAIL: promotion task did not pay 1 credit';
    END IF;

    SELECT remaining_budget,status
    INTO v_remaining_after,v_status
    FROM public.promotions WHERE id=v_promo;

    -- Every successful completion is moved outside the one-minute window.
    UPDATE public.task_completions
    SET completed_at=now()-interval '2 minutes'
    WHERE task_id=v_task AND user_id=v_admin;
  END LOOP;

  SELECT remaining_budget,status
  INTO v_remaining_after,v_status
  FROM public.promotions WHERE id=v_promo;

  IF v_remaining_after<>0 OR v_status<>'completed' THEN
    RAISE EXCEPTION
      'FAIL: budget exhaustion did not complete promotion (%,%)',
      v_remaining_after,v_status;
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.tasks
    WHERE promotion_id=v_promo AND status<>'completed'
  ) THEN
    RAISE EXCEPTION 'FAIL: not all exhausted promotion tasks completed';
  END IF;

  ------------------------------------------------------------------
  -- 5. VERIFICATION PENDING / REJECTED / APPROVED
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/example-verification/',
    'TEST verification','Promotion',2,'active'
  ) RETURNING id INTO v_task;

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

  ------------------------------------------------------------------
  -- 6. CANCELLATION -> UNUSED BUDGET REFUND
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  v_promo:=public.create_promotion(
    v_social_profile,'TEST cancel','Instagram','Follow',
    'https://www.instagram.com/example-cancel/',10
  );

  SELECT credits INTO v_before
  FROM public.profiles WHERE id=v_user;

  IF public.cancel_promotion(v_promo)<>10 THEN
    RAISE EXCEPTION 'FAIL: cancellation refund amount';
  END IF;

  SELECT credits INTO v_after
  FROM public.profiles WHERE id=v_user;

  IF v_after<>v_before+10 THEN
    RAISE EXCEPTION 'FAIL: cancellation did not refund 10 credits';
  END IF;

  ------------------------------------------------------------------
  -- 7. ADMIN TASK DELETION -> REMAINING BUDGET REFUND
  ------------------------------------------------------------------
  v_promo:=public.create_promotion(
    v_social_profile,'TEST admin delete','Instagram','Follow',
    'https://www.instagram.com/example-admin-delete/',10
  );

  SELECT user_id,remaining_budget
  INTO v_user,v_remaining_before
  FROM public.promotions WHERE id=v_promo;

  SELECT id INTO v_task
  FROM public.tasks
  WHERE promotion_id=v_promo
  ORDER BY created_at
  LIMIT 1;

  SELECT credits INTO v_before
  FROM public.profiles WHERE id=v_user;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.admin_delete_task(v_task);

  SELECT credits INTO v_after
  FROM public.profiles WHERE id=v_user;

  IF v_after<>v_before+v_remaining_before THEN
    RAISE EXCEPTION
      'FAIL: admin task deletion did not refund remaining budget';
  END IF;

  SELECT status INTO v_status
  FROM public.promotions WHERE id=v_promo;

  IF v_status<>'cancelled' THEN
    RAISE EXCEPTION 'FAIL: admin deletion did not cancel promotion';
  END IF;

  ------------------------------------------------------------------
  -- 8. 30 TASKS / MINUTE
  -- Seed 29 recent completions, then use real complete_task calls
  -- for completion #30 and #31. This directly tests the boundary.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  SELECT
    v_user,'Instagram','Follow',
    'https://www.instagram.com/rate-history-'||g||'/',
    'RATE-HISTORY-'||g,'Promotion',1,'completed'
  FROM generate_series(1,29) g;

  INSERT INTO public.task_completions(task_id,user_id,reward,completed_at)
  SELECT
    t.id,v_admin,1,now()-interval '10 seconds'
  FROM public.tasks t
  WHERE t.owner_id=v_user
    AND t.title LIKE 'RATE-HISTORY-%';

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/rate-real-30/',
    'RATE-REAL-30','Promotion',1,'active'
  ) RETURNING id INTO v_task;

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task,v_admin,'approved');

  IF public.complete_task(v_task)<>1 THEN
    RAISE EXCEPTION 'FAIL: 30th/minute completion was blocked';
  END IF;

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/rate-real-31/',
    'RATE-REAL-31','Promotion',1,'active'
  ) RETURNING id INTO v_task2;

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task2,v_admin,'approved');

  v_err:=NULL;
  BEGIN
    PERFORM public.complete_task(v_task2);
  EXCEPTION WHEN OTHERS THEN
    v_err:=SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT ILIKE '%Too many task completions%' THEN
    RAISE EXCEPTION
      'FAIL: 31st/minute limit did not fire: %',
      COALESCE(v_err,'no error');
  END IF;

  ------------------------------------------------------------------
  -- 9. 300 TASKS / DAY
  -- Seed 299 completed tasks earlier today but outside the minute
  -- window, then use real complete_task calls for #300 and #301.
  ------------------------------------------------------------------
  UPDATE public.task_completions
  SET completed_at=date_trunc('day',now())-interval '1 second'
  WHERE user_id=v_admin;

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  )
  SELECT
    v_user,'Instagram','Follow',
    'https://www.instagram.com/day-history-'||g||'/',
    'DAY-HISTORY-'||g,'Promotion',1,'completed'
  FROM generate_series(1,299) g;

  INSERT INTO public.task_completions(task_id,user_id,reward,completed_at)
  SELECT
    t.id,v_admin,1,now()-interval '2 minutes'
  FROM public.tasks t
  WHERE t.owner_id=v_user
    AND t.title LIKE 'DAY-HISTORY-%';

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/day-real-300/',
    'DAY-REAL-300','Promotion',1,'active'
  ) RETURNING id INTO v_task;

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task,v_admin,'approved');

  IF public.complete_task(v_task)<>1 THEN
    RAISE EXCEPTION 'FAIL: 300th/day completion was blocked';
  END IF;

  INSERT INTO public.tasks(
    owner_id,platform,action,target_url,title,category,reward,status
  ) VALUES(
    v_user,'Instagram','Follow',
    'https://www.instagram.com/day-real-301/',
    'DAY-REAL-301','Promotion',1,'active'
  ) RETURNING id INTO v_task2;

  INSERT INTO public.task_verifications(task_id,user_id,status)
  VALUES(v_task2,v_admin,'approved');

  v_err:=NULL;
  BEGIN
    PERFORM public.complete_task(v_task2);
  EXCEPTION WHEN OTHERS THEN
    v_err:=SQLERRM;
  END;

  IF v_err IS NULL OR v_err NOT ILIKE '%Daily task completion limit%' THEN
    RAISE EXCEPTION
      'FAIL: 301st/day limit did not fire: %',
      COALESCE(v_err,'no error');
  END IF;

  ------------------------------------------------------------------
  -- 10. FINAL LEDGER CONSISTENCY
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);

  SELECT profile_balance,ledger_net,difference
  INTO v_balance_after,v_ledger_after,v_difference_after
  FROM public.credit_ledger_check(v_user);

  IF v_difference_after<>v_difference_before THEN
    RAISE EXCEPTION
      'FAIL: ledger difference changed from % to %',
      v_difference_before,v_difference_after;
  END IF;

  IF v_balance_after-v_balance_before<>v_ledger_after-v_ledger_before THEN
    RAISE EXCEPTION
      'FAIL: profile balance delta does not match ledger delta';
  END IF;

  RAISE NOTICE 'ALL ECONOMY TESTS PASSED';
END;
$$;

ROLLBACK;
