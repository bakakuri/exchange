BEGIN;

-- Real economy integration test.
-- Uses existing accounts only and rolls everything back at the end.
-- Run in Supabase SQL Editor as a database owner/admin.
-- The test requires at least 3 ordinary users and 1 admin, with no task
-- completions for the selected test users since the start of today.

do $$
declare
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
begin
  select id into v_u1 from public.profiles p
  where role='user'
    and not exists(select 1 from public.task_completions c where c.user_id=p.id and c.completed_at>=date_trunc('day',now()))
  order by created_at limit 1;

  select id into v_u2 from public.profiles p
  where role='user' and id<>v_u1
    and not exists(select 1 from public.task_completions c where c.user_id=p.id and c.completed_at>=date_trunc('day',now()))
  order by created_at limit 1;

  select id into v_admin from public.profiles where role='admin' order by created_at limit 1;

  if v_u1 is null or v_u2 is null or v_admin is null then
    raise exception 'TEST SETUP FAILED: need at least 2 clean users and 1 admin';
  end if;

  -- 1. Starter task -> credits and transaction.
  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  values(v_u1,'Instagram','Follow','https://www.instagram.com/example/','TEST starter reward','Starter',7,'active')
  returning id,reward into v_task,v_reward;
  perform set_config('request.jwt.claim.sub',v_u1::text,true);
  select credits into v_before from public.profiles where id=v_u1;
  if public.complete_task(v_task)<>v_reward then raise exception 'FAIL: task reward return'; end if;
  select credits into v_after from public.profiles where id=v_u1;
  if v_after<>v_before+v_reward then raise exception 'FAIL: credits did not increase'; end if;
  if not exists(
    select 1 from public.credit_transactions ct
    where ct.task_completion_id in(select id from public.task_completions where task_id=v_task and user_id=v_u1)
      and ct.amount=v_reward and ct.type='task_reward'
  ) then raise exception 'FAIL: reward transaction missing'; end if;

  -- 2. Duplicate reward is blocked.
  v_err:=null;
  begin perform public.complete_task(v_task); exception when others then v_err:=sqlerrm; end;
  if v_err is null or v_err not ilike '%already completed%' then
    raise exception 'FAIL: duplicate completion not blocked: %',coalesce(v_err,'no error');
  end if;

  -- 3. Own non-Starter task is blocked.
  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  values(v_u1,'Instagram','Follow','https://www.instagram.com/example-own/','TEST own task','Promotion',3,'active')
  returning id into v_task2;
  v_err:=null;
  begin perform public.complete_task(v_task2); exception when others then v_err:=sqlerrm; end;
  if v_err is null or v_err not ilike '%own task%' then
    raise exception 'FAIL: self completion not blocked: %',coalesce(v_err,'no error');
  end if;

  -- 4. Promotion budget decrement and exhaustion.
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform public.admin_adjust_credits(v_u1,50,'test setup');
  perform set_config('request.jwt.claim.sub',v_u1::text,true);
  insert into public.social_profiles(user_id,platform,handle,url,active)
  values(v_u1,'Instagram','test-economy','https://www.instagram.com/test-economy/','true')
  returning id into v_task2;
  v_promo:=public.create_promotion(v_task2,'TEST budget','Instagram','Follow','https://www.instagram.com/example-budget/',10);
  select remaining_budget,reward into v_before_remaining,v_reward from public.promotions where id=v_promo;
  select id into v_task from public.tasks where promotion_id=v_promo;
  perform set_config('request.jwt.claim.sub',v_u2::text,true);
  insert into public.task_verifications(task_id,user_id,status) values(v_task,v_u2,'approved');
  perform public.complete_task(v_task);
  select remaining_budget,status into v_after_remaining,v_err from public.promotions where id=v_promo;
  if v_after_remaining<>v_before_remaining-v_reward then raise exception 'FAIL: budget did not decrement'; end if;
  if v_after_remaining<>0 or v_err<>'completed' then raise exception 'FAIL: budget exhaustion did not complete promotion'; end if;
  select status into v_err from public.tasks where id=v_task;
  if v_err<>'completed' then raise exception 'FAIL: exhausted promotion task not completed'; end if;

  -- 5. Verification pending -> rejected -> approved.
  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  values(v_u1,'Instagram','Follow','https://www.instagram.com/verify-test/','TEST verification','Promotion',2,'active')
  returning id into v_task;
  insert into public.task_verifications(task_id,user_id,status) values(v_task,v_u2,'pending');
  v_err:=null; begin perform public.complete_task(v_task); exception when others then v_err:=sqlerrm; end;
  if v_err is null or v_err not ilike '%pending%' then raise exception 'FAIL: pending verification not blocked: %',coalesce(v_err,'no error'); end if;
  update public.task_verifications set status='rejected' where task_id=v_task and user_id=v_u2;
  v_err:=null; begin perform public.complete_task(v_task); exception when others then v_err:=sqlerrm; end;
  if v_err is null or v_err not ilike '%rejected%' then raise exception 'FAIL: rejected verification not blocked: %',coalesce(v_err,'no error'); end if;
  update public.task_verifications set status='approved' where task_id=v_task and user_id=v_u2;
  if public.complete_task(v_task)<>2 then raise exception 'FAIL: approved verification did not pay'; end if;

  -- 6. Cancellation refunds the remaining budget.
  perform set_config('request.jwt.claim.sub',v_u1::text,true);
  v_promo:=public.create_promotion(v_task2,'TEST cancel','Instagram','Follow','https://www.instagram.com/example-cancel/',10);
  select credits into v_before from public.profiles where id=v_u1;
  if public.cancel_promotion(v_promo)<>10 then raise exception 'FAIL: cancellation refund amount'; end if;
  select credits into v_after from public.profiles where id=v_u1;
  if v_after<>v_before+10 then raise exception 'FAIL: cancellation did not refund credits'; end if;

  -- 7. Admin task deletion refunds the unused promotion budget.
  v_promo:=public.create_promotion(v_task2,'TEST admin delete','Instagram','Follow','https://www.instagram.com/example-admin-delete/',10);
  select user_id,remaining_budget into v_task2,v_before_remaining from public.promotions where id=v_promo;
  select id into v_task from public.tasks where promotion_id=v_promo limit 1;
  select credits into v_before from public.profiles where id=v_task2;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform public.admin_delete_task(v_task);
  select credits into v_after from public.profiles where id=v_task2;
  if v_after<>v_before+v_before_remaining then raise exception 'FAIL: admin deletion did not refund remaining budget'; end if;
  if exists(select 1 from public.promotions where id=v_promo and status<>'cancelled') then raise exception 'FAIL: admin deletion did not cancel promotion'; end if;

  -- 8. Ledger arithmetic is internally consistent.
  perform set_config('request.jwt.claim.sub',v_u1::text,true);
  select profile_balance,ledger_net,difference into v_balance_before,v_ledger_before,v_count from public.credit_ledger_check(v_u1);
  if v_count<>v_balance_before-v_ledger_before then raise exception 'FAIL: ledger check arithmetic'; end if;

  -- 9. 30/minute: first 30 succeed, 31st fails.
  perform set_config('request.jwt.claim.sub',v_u2::text,true);
  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  select v_u2,'Instagram','Follow','https://www.instagram.com/rate-'||g||'/','RATE '||g,'Starter',1,'active'
  from generate_series(1,31) g;
  v_count:=0;
  for v_task in select id from public.tasks where owner_id=v_u2 and title like 'RATE %' order by title loop
    v_count:=v_count+1;
    v_err:=null;
    begin perform public.complete_task(v_task); exception when others then v_err:=sqlerrm; end;
    if v_count<=30 and v_err is not null then raise exception 'FAIL: completion % unexpectedly blocked: %',v_count,v_err; end if;
    if v_count=31 and (v_err is null or v_err not ilike '%Too many task completions%') then
      raise exception 'FAIL: 31st/minute limit did not fire: %',coalesce(v_err,'no error');
    end if;
  end loop;

  -- 10. 300/day: isolate on a third clean user.
  select id into v_task2 from public.profiles p
  where role='user' and id not in(v_u1,v_u2)
    and not exists(select 1 from public.task_completions c where c.user_id=p.id and c.completed_at>=date_trunc('day',now()))
  order by created_at limit 1;
  if v_task2 is null then raise exception 'TEST SETUP FAILED: need a third clean user for 300/day test'; end if;
  perform set_config('request.jwt.claim.sub',v_task2::text,true);
  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  select v_task2,'Instagram','Follow','https://www.instagram.com/day-'||g||'/','DAY '||g,'Starter',1,'active'
  from generate_series(1,301) g;
  v_count:=0;
  for v_task in select id from public.tasks where owner_id=v_task2 and title like 'DAY %' order by title loop
    v_count:=v_count+1;
    v_err:=null;
    begin perform public.complete_task(v_task); exception when others then v_err:=sqlerrm; end;
    if v_count<=300 and v_err is not null then raise exception 'FAIL: day completion % unexpectedly blocked: %',v_count,v_err; end if;
    if v_count=301 and (v_err is null or v_err not ilike '%Daily task completion limit%') then
      raise exception 'FAIL: 301st/day limit did not fire: %',coalesce(v_err,'no error');
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub',v_u1::text,true);
  select profile_balance,ledger_net,difference into v_balance_after,v_ledger_after,v_count from public.credit_ledger_check(v_u1);
  if v_count<>v_balance_after-v_ledger_after then raise exception 'FAIL: final ledger arithmetic'; end if;

  raise notice 'ALL ECONOMY TESTS PASSED';
end;
$$;

ROLLBACK;
