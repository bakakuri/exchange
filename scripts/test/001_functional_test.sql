-- 001_functional_test.sql
-- Exercises the full loop end to end against the real migrations, using
-- app.current_user_id to simulate auth.uid() for each acting user. IDs
-- captured along the way are stashed in a temp table (test_state)
-- instead of psql variables, since psql does not interpolate :'var'
-- inside dollar-quoted DO blocks. Every check either
-- RAISE NOTICE 'PASS: ...' or RAISE EXCEPTION on failure, so a clean run
-- with no exception is the pass condition.

\set ON_ERROR_STOP on

create temporary table test_state (key text primary key, value text);

create or replace function test_get(p_key text) returns text language sql as
  $$ select value from test_state where key = p_key $$;
create or replace function test_set(p_key text, p_value text) returns void language sql as
  $$ insert into test_state (key, value) values (p_key, p_value)
     on conflict (key) do update set value = excluded.value $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'bob@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'carol@example.com');

do $$
begin
  if (select count(*) from public.profiles) <> 4 then
    raise exception 'FAIL: handle_new_user did not create 4 profiles';
  end if;
  raise notice 'PASS: handle_new_user auto-created profiles with referral codes for all signups';
end $$;

-- Bootstrap the first admin directly (there is no admin yet to call
-- admin_update_user, so this one-time step is a plain UPDATE - exactly
-- how a real deployment bootstraps its first administrator too).
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000001';

-- Tasks done from an account (follow, like...) need the doer's linked
-- account for that platform (021_trust_and_economy.sql).
insert into public.social_profiles (user_id, platform, username, profile_url) values
  ('00000000-0000-0000-0000-000000000003', 'instagram', 'bob_ig', 'https://instagram.com/bob_ig'),
  ('00000000-0000-0000-0000-000000000004', 'x', 'carol_x', 'https://x.com/carol_x');

-- ---------------------------------------------------- admin credit grant
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000001', false);
select public.admin_credit_adjustment('00000000-0000-0000-0000-000000000002', 500, 'seed for testing');

do $$
begin
  if (select credits from public.profiles where id = '00000000-0000-0000-0000-000000000002') <> 500 then
    raise exception 'FAIL: admin_credit_adjustment did not credit alice';
  end if;
  raise notice 'PASS: admin_credit_adjustment granted 500 credits to alice';
end $$;

do $$
begin
  begin
    perform public.admin_credit_adjustment('00000000-0000-0000-0000-000000000002', 100, '');
    raise exception 'FAIL: admin_credit_adjustment accepted an empty reason';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
    raise notice 'PASS: admin_credit_adjustment rejects an empty reason';
  end;
end $$;

-- --------------------------------------------------- non-admin cannot admin
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    perform public.admin_credit_adjustment('00000000-0000-0000-0000-000000000003', 100, 'not allowed');
    raise exception 'FAIL: a non-admin was able to call admin_credit_adjustment';
  exception when others then
    if sqlerrm not like 'FORBIDDEN%' then raise; end if;
    raise notice 'PASS: non-admin is rejected by admin_credit_adjustment';
  end;
end $$;

-- ----------------------------------------------------- campaign creation
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', false); -- alice
select test_set('campaign_id', public.create_campaign(
  'Follow my page', 'Please follow', 'instagram', 'follow',
  'https://instagram.com/example', 'Just follow', 'manual_proof', 50, 5
)::text);

do $$
begin
  if (select credits from public.profiles where id = '00000000-0000-0000-0000-000000000002') <> 250 then
    raise exception 'FAIL: campaign reservation did not debit alice (expected 500-250=250)';
  end if;
  raise notice 'PASS: create_campaign reserved reward*desired_completions (250) from alice''s balance';
end $$;

do $$
declare
  v_campaign_id uuid := test_get('campaign_id')::uuid;
begin
  if not exists (select 1 from public.campaigns where id = v_campaign_id and status = 'active' and remaining_budget = 250) then
    raise exception 'FAIL: campaign row not created as expected';
  end if;
  if not exists (select 1 from public.tasks where campaign_id = v_campaign_id) then
    raise exception 'FAIL: task row not created alongside campaign';
  end if;
  raise notice 'PASS: campaign + task created together, active, remaining_budget=250';
end $$;

select test_set('task_id', id::text) from public.tasks where campaign_id = test_get('campaign_id')::uuid;

-- ------------------------------------------------------ insufficient credits
do $$
begin
  begin
    perform public.create_campaign('Too expensive', '', 'youtube', 'subscribe',
      'https://youtube.com/x', '', 'manual_proof', 1000, 1);
    raise exception 'FAIL: create_campaign succeeded despite insufficient balance';
  exception when others then
    if sqlerrm not like 'INSUFFICIENT_CREDITS%' then raise; end if;
    raise notice 'PASS: create_campaign fails atomically on insufficient credits (no partial rows left behind)';
  end;
end $$;

do $$
begin
  if exists (select 1 from public.campaigns where title = 'Too expensive') then
    raise exception 'FAIL: a campaign row was left behind after a failed reservation';
  end if;
  raise notice 'PASS: no orphaned campaign/task rows after the failed reservation';
end $$;

-- --------------------------------------------------------- self-task guard
do $$
begin
  begin
    perform public.submit_task_verification(test_get('task_id')::uuid, null, 'I did it myself');
    raise exception 'FAIL: campaign creator was able to complete their own task';
  exception when others then
    if sqlerrm not like 'SELF_TASK_FORBIDDEN%' then raise; end if;
    raise notice 'PASS: self-task completion is rejected';
  end;
end $$;

-- ------------------------------------------------------------- completion
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', false); -- bob
select test_set('completion_id', public.submit_task_verification(
  test_get('task_id')::uuid, 'https://proof.example/bob.png', null, null,
  (select id from public.social_profiles where user_id = '00000000-0000-0000-0000-000000000003' and platform = 'instagram')
)::text);

do $$
begin
  if not exists (select 1 from public.task_completions where id = test_get('completion_id')::uuid and status = 'pending') then
    raise exception 'FAIL: completion not recorded as pending';
  end if;
  raise notice 'PASS: bob''s submission recorded as pending, with proof stored in task_verifications';
end $$;

-- ------------------------------------------------------------- duplicate guard
do $$
begin
  begin
    perform public.submit_task_verification(test_get('task_id')::uuid, 'https://proof.example/bob2.png', null);
    raise exception 'FAIL: bob was able to submit the same task twice';
  exception when others then
    if sqlerrm not like 'TASK_ALREADY_COMPLETED%' then raise; end if;
    raise notice 'PASS: duplicate submission is rejected';
  end;
end $$;

-- --------------------------------------------------- review by non-owner
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', false); -- carol
do $$
begin
  begin
    perform public.review_task_verification(test_get('completion_id')::uuid, 'approved', 'not mine to review');
    raise exception 'FAIL: a stranger was able to review a completion';
  exception when others then
    if sqlerrm not like 'FORBIDDEN%' then raise; end if;
    raise notice 'PASS: only the campaign owner (or admin) can review a completion';
  end;
end $$;

-- ------------------------------------------------------------- approval
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', false); -- alice (owner)
select public.review_task_verification(test_get('completion_id')::uuid, 'approved', 'looks good');

do $$
declare
  v_campaign_id uuid := test_get('campaign_id')::uuid;
  v_completion_id uuid := test_get('completion_id')::uuid;
begin
  if (select status from public.task_completions where id = v_completion_id) <> 'approved' then
    raise exception 'FAIL: completion not marked approved';
  end if;
  if (select credits from public.profiles where id = '00000000-0000-0000-0000-000000000003') <> 50 then
    raise exception 'FAIL: bob was not credited the reward';
  end if;
  if (select remaining_budget from public.campaigns where id = v_campaign_id) <> 200 then
    raise exception 'FAIL: campaign remaining_budget not decremented';
  end if;
  if (select completed_count from public.campaigns where id = v_campaign_id) <> 1 then
    raise exception 'FAIL: campaign completed_count not incremented';
  end if;
  if (select xp from public.profiles where id = '00000000-0000-0000-0000-000000000003') <> 10 then
    raise exception 'FAIL: bob was not awarded XP';
  end if;
  raise notice 'PASS: approval atomically rewarded bob, decremented budget, incremented completed_count, awarded XP';
end $$;

do $$
begin
  if not exists (select 1 from public.credit_ledger where user_id = '00000000-0000-0000-0000-000000000003' and type = 'task_reward' and amount = 50) then
    raise exception 'FAIL: no task_reward ledger row for bob';
  end if;
  if not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000003' and type = 'verification_approved') then
    raise exception 'FAIL: no verification_approved notification for bob';
  end if;
  if not exists (select 1 from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id where ua.user_id = '00000000-0000-0000-0000-000000000003' and a.code = 'first_task') then
    raise exception 'FAIL: first_task achievement not unlocked for bob';
  end if;
  raise notice 'PASS: ledger entry, notification and first_task achievement all created for bob';
end $$;

-- ------------------------------------------------------- re-review guard
do $$
begin
  begin
    perform public.review_task_verification(test_get('completion_id')::uuid, 'rejected', 'changed my mind');
    raise exception 'FAIL: an already-reviewed completion was reviewed again';
  exception when others then
    if sqlerrm not like 'VERIFICATION_ALREADY_REVIEWED%' then raise; end if;
    raise notice 'PASS: a completion cannot be reviewed twice';
  end;
end $$;

-- -------------------------------------------- direct reward_task_completion is not RPC-reachable
do $$
declare
  v_can_execute boolean;
begin
  select has_function_privilege('authenticated', 'public.reward_task_completion(uuid,uuid)', 'execute') into v_can_execute;
  if v_can_execute then
    raise exception 'FAIL: authenticated role can call reward_task_completion directly (privilege escalation risk)';
  end if;
  raise notice 'PASS: reward_task_completion has no client EXECUTE grant (internal-only)';
end $$;

-- ------------------------------------------------------- cancel + refund
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', false); -- alice
select public.cancel_campaign(test_get('campaign_id')::uuid, 'changed my mind');

do $$
declare
  v_campaign_id uuid := test_get('campaign_id')::uuid;
begin
  if (select status from public.campaigns where id = v_campaign_id) <> 'cancelled' then
    raise exception 'FAIL: campaign not marked cancelled';
  end if;
  if (select credits from public.profiles where id = '00000000-0000-0000-0000-000000000002') <> 450 then
    raise exception 'FAIL: cancellation did not refund remaining budget (expected 250+200=450)';
  end if;
  if not exists (select 1 from public.credit_ledger where user_id = '00000000-0000-0000-0000-000000000002' and type = 'campaign_refund' and amount = 200) then
    raise exception 'FAIL: no campaign_refund ledger row for alice';
  end if;
  raise notice 'PASS: cancel_campaign refunded the remaining budget and logged it';
end $$;

do $$
begin
  begin
    perform public.cancel_campaign(test_get('campaign_id')::uuid, 'again');
    raise exception 'FAIL: a cancelled campaign was cancelled again';
  exception when others then
    if sqlerrm not like 'CAMPAIGN_CANCELLED%' then raise; end if;
    raise notice 'PASS: a cancelled campaign cannot be cancelled again';
  end;
end $$;

-- --------------------------------------------------------- referral loop
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', false); -- carol
select test_set('bob_referral_code', referral_code) from public.profiles where id = '00000000-0000-0000-0000-000000000003';
select public.claim_referral(test_get('bob_referral_code'));

do $$
begin
  if not exists (select 1 from public.referrals where referrer_id = '00000000-0000-0000-0000-000000000003' and referred_id = '00000000-0000-0000-0000-000000000004' and status = 'pending') then
    raise exception 'FAIL: referral not recorded as pending';
  end if;
  raise notice 'PASS: carol claimed bob''s referral code, recorded as pending (no reward yet)';
end $$;

-- carol needs a campaign to complete. Not bob's: since 021 a referrer's
-- own campaign never earns the referral bonus (that was a free-credit
-- loop), so alice - unconnected to either - creates one.
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000001', false); -- admin
select public.admin_credit_adjustment('00000000-0000-0000-0000-000000000002', 100, 'seed for referral test');
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', false); -- alice
select test_set('ref_campaign_id', public.create_campaign(
  'Referral test campaign', '', 'x', 'like', 'https://x.com/y', '', 'manual_proof', 10, 1
)::text);
select test_set('reftask_id', id::text) from public.tasks where campaign_id = test_get('ref_campaign_id')::uuid;
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000004', false); -- carol
select test_set('ref_completion_id', public.submit_task_verification(
  test_get('reftask_id')::uuid, 'https://proof.example/carol.png', null, null,
  (select id from public.social_profiles where user_id = '00000000-0000-0000-0000-000000000004' and platform = 'x')
)::text);
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000002', false); -- alice owns this campaign
select public.review_task_verification(test_get('ref_completion_id')::uuid, 'approved', 'ok');

do $$
begin
  if (select status from public.referrals where referred_id = '00000000-0000-0000-0000-000000000004') <> 'rewarded' then
    raise exception 'FAIL: referral was not rewarded on carol''s first approved completion';
  end if;
  if not exists (select 1 from public.credit_ledger where user_id = '00000000-0000-0000-0000-000000000003' and type = 'referral_reward') then
    raise exception 'FAIL: referrer (bob) was not paid the referral bonus';
  end if;
  if not exists (select 1 from public.credit_ledger where user_id = '00000000-0000-0000-0000-000000000004' and type = 'referral_reward') then
    raise exception 'FAIL: referred user (carol) was not paid the welcome bonus';
  end if;
  raise notice 'PASS: referral reward paid to both parties on the referred user''s first approved completion';
end $$;

-- --------------------------------------------------- last-admin protection
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000001', false); -- the only admin
do $$
begin
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-000000000001', 'user', 'active', 'testing');
    raise exception 'FAIL: the last administrator was demoted';
  exception when others then
    if sqlerrm not like 'FORBIDDEN%' then raise; end if;
    raise notice 'PASS: the last administrator cannot be demoted';
  end;
end $$;

-- ------------------------------------------------------------------ RLS
set role authenticated;
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000000003', false); -- bob

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.credit_ledger;
  if v_count <> (select count(*) from public.credit_ledger where user_id = '00000000-0000-0000-0000-000000000003') then
    raise exception 'FAIL: RLS leaked another user''s ledger rows to bob';
  end if;
  raise notice 'PASS: RLS restricts credit_ledger reads to the caller''s own rows';
end $$;

do $$
begin
  begin
    update public.profiles set credits = 999999 where id = '00000000-0000-0000-0000-000000000003';
    raise exception 'FAIL: an authenticated user updated their own credits column directly';
  exception when insufficient_privilege then
    raise notice 'PASS: column-level grants block a direct client UPDATE of profiles.credits';
  end;
end $$;

reset role;

do $$ begin raise notice '=== ALL CHECKS PASSED ==='; end $$;
