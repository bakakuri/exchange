-- 015_functions.sql
-- The authoritative business-logic layer. Every economically or
-- structurally significant operation in the platform has exactly one
-- implementation here, called via Supabase RPC from the backend
-- (server/services/*, added in later stages) - never re-implemented in
-- application code. Functions are SECURITY DEFINER (so they can write
-- across the tables they need to, bypassing the client-facing RLS
-- policies in 014_rls.sql), but every function that acts "as" a user
-- resolves that user from auth.uid() itself rather than trusting a
-- caller-supplied id parameter - a client can never pass someone else's
-- id and act on their behalf. Internal-only helpers that don't
-- independently re-validate every parameter (write_ledger_entry,
-- award_xp, check_achievements, try_reward_referral, log_audit_event,
-- reward_task_completion) have their client EXECUTE grant revoked at the
-- bottom of this file; they are reachable only by being called from
-- inside another SECURITY DEFINER function, never directly by RPC.
--
-- Error convention: exceptions are raised as
--   'ERROR_CODE: human readable detail'
-- using errcode P0001. The service layer splits on ': ' to map the code
-- to the canonical ErrorCodes in server/utils/errors.js - one shared
-- vocabulary between the database and the API (section 46 of the spec).

-- ============================================================ XP / LEVEL

create or replace function public.calculate_level(p_xp integer)
returns integer
language sql
immutable
as $$
  select greatest(1, floor(p_xp / 1000.0)::integer + 1);
$$;

create or replace function public.award_xp(p_user_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_xp integer;
begin
  update public.profiles
  set xp = xp + p_amount
  where id = p_user_id
  returning xp into v_new_xp;

  update public.profiles
  set level = public.calculate_level(v_new_xp)
  where id = p_user_id;
end;
$$;

-- ========================================================= CREDIT LEDGER

-- The one place a balance ever changes. The guarded UPDATE
-- (WHERE credits + p_amount >= 0) takes a row lock implicitly, so
-- concurrent calls for the same user serialize safely and a balance can
-- never go negative.
create or replace function public.write_ledger_entry(
  p_user_id uuid,
  p_amount integer,
  p_type ledger_transaction_type,
  p_description text,
  p_task_id uuid,
  p_campaign_id uuid,
  p_created_by uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  update public.profiles
  set credits = credits + p_amount
  where id = p_user_id and credits + p_amount >= 0
  returning credits into v_new_balance;

  if not found then
    raise exception 'INSUFFICIENT_CREDITS: user % has insufficient balance for amount %', p_user_id, p_amount
      using errcode = 'P0001';
  end if;

  insert into public.credit_ledger (
    user_id, amount, type, description, balance_after,
    related_task_id, related_campaign_id, created_by
  ) values (
    p_user_id, p_amount, p_type, coalesce(p_description, ''), v_new_balance,
    p_task_id, p_campaign_id, p_created_by
  );

  return v_new_balance;
end;
$$;

-- ============================================================ ACHIEVEMENTS

create or replace function public.check_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approved_completions integer;
  v_rejected_completions integer;
  v_campaigns_created integer;
  v_lifetime_earned integer;
  v_code text;
  v_achievement_id uuid;
  v_inserted_id uuid;
begin
  select count(*) into v_approved_completions
  from public.task_completions where user_id = p_user_id and status = 'approved';

  select count(*) into v_rejected_completions
  from public.task_completions where user_id = p_user_id and status = 'rejected';

  select count(*) into v_campaigns_created
  from public.campaigns where creator_id = p_user_id;

  select coalesce(sum(amount), 0) into v_lifetime_earned
  from public.credit_ledger where user_id = p_user_id and amount > 0;

  for v_code in
    select code from (values
      ('first_task', v_approved_completions >= 1),
      ('tasks_10', v_approved_completions >= 10),
      ('tasks_50', v_approved_completions >= 50),
      ('tasks_100', v_approved_completions >= 100),
      ('first_campaign', v_campaigns_created >= 1),
      ('campaigns_10', v_campaigns_created >= 10),
      ('credits_1000', v_lifetime_earned >= 1000),
      ('credits_10000', v_lifetime_earned >= 10000),
      ('trusted_contributor', v_approved_completions >= 50 and v_rejected_completions = 0)
    ) as candidates(code, earned)
    where earned
  loop
    select id into v_achievement_id from public.achievements where code = v_code;

    insert into public.user_achievements (user_id, achievement_id)
    values (p_user_id, v_achievement_id)
    on conflict (user_id, achievement_id) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is not null then
      insert into public.notifications (user_id, type, title, body, dedup_key)
      select p_user_id, 'achievement_unlocked', 'Achievement unlocked', a.title, 'achievement:' || a.id
      from public.achievements a where a.code = v_code;

      insert into public.activity (user_id, type, metadata)
      values (p_user_id, 'achievement_unlocked', jsonb_build_object('code', v_code));
    end if;

    v_inserted_id := null;
  end loop;
end;
$$;

-- ============================================================== REFERRALS

create or replace function public.claim_referral(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_referrer_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id and referred_by is not null) then
    raise exception 'VALIDATION_ERROR: this account has already claimed a referral code'
      using errcode = 'P0001';
  end if;

  select id into v_referrer_id from public.profiles where referral_code = p_code;

  if v_referrer_id is null then
    raise exception 'VALIDATION_ERROR: referral code not found' using errcode = 'P0001';
  end if;

  if v_referrer_id = v_user_id then
    raise exception 'VALIDATION_ERROR: cannot refer yourself' using errcode = 'P0001';
  end if;

  update public.profiles set referred_by = v_referrer_id where id = v_user_id;

  insert into public.referrals (referrer_id, referred_id) values (v_referrer_id, v_user_id);
end;
$$;

-- Called from reward_task_completion() after an approval. Pays out the
-- referral bonus the first time (and only the first time) the referred
-- user earns an approved completion - signing up alone earns nothing, to
-- keep referral farming from being free (section 30).
create or replace function public.try_reward_referral(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral record;
  v_bonus constant integer := 20;
begin
  select * into v_referral from public.referrals
  where referred_id = p_user_id and status = 'pending'
  for update;

  if not found then
    return;
  end if;

  if (select count(*) from public.task_completions where user_id = p_user_id and status = 'approved') <> 1 then
    return; -- not their first approved completion
  end if;

  update public.referrals
  set status = 'rewarded', reward_issued_at = now()
  where id = v_referral.id;

  perform public.write_ledger_entry(v_referral.referrer_id, v_bonus, 'referral_reward',
    'Referral bonus', null, null, null);
  perform public.write_ledger_entry(p_user_id, v_bonus, 'referral_reward',
    'Referral welcome bonus', null, null, null);

  insert into public.notifications (user_id, type, title, body, dedup_key)
  values (v_referral.referrer_id, 'referral_reward', 'Referral bonus earned',
    'A friend you referred just completed their first task.', 'referral:' || v_referral.id);

  insert into public.activity (user_id, type, metadata)
  values (v_referral.referrer_id, 'referral_joined', jsonb_build_object('referred_id', p_user_id));
end;
$$;

-- ============================================================== CAMPAIGNS

create or replace function public.create_campaign(
  p_title text,
  p_description text,
  p_platform task_platform,
  p_task_type task_type,
  p_target_url text,
  p_instructions text,
  p_verification_method verification_method,
  p_reward integer,
  p_desired_completions integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid := auth.uid();
  v_campaign_id uuid;
  v_total_budget integer;
begin
  if v_creator_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  if p_reward <= 0 or p_desired_completions <= 0 then
    raise exception 'VALIDATION_ERROR: reward and desired_completions must be positive'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = v_creator_id and status = 'active') then
    raise exception 'FORBIDDEN: account is not active' using errcode = 'P0001';
  end if;

  v_total_budget := p_reward * p_desired_completions;

  insert into public.campaigns (creator_id, title, description, reward, desired_completions, remaining_budget)
  values (v_creator_id, p_title, coalesce(p_description, ''), p_reward, p_desired_completions, v_total_budget)
  returning id into v_campaign_id;

  insert into public.tasks (campaign_id, platform, task_type, target_url, instructions, verification_method)
  values (v_campaign_id, p_platform, p_task_type, p_target_url, coalesce(p_instructions, ''), p_verification_method);

  -- Reserve the budget. If the creator can't afford it, write_ledger_entry
  -- raises INSUFFICIENT_CREDITS and the whole function rolls back,
  -- including the campaign/task rows just inserted above - nothing is
  -- ever left half-created.
  perform public.write_ledger_entry(v_creator_id, -v_total_budget, 'campaign_reservation',
    p_title, null, v_campaign_id, v_creator_id);

  insert into public.activity (user_id, type, related_campaign_id)
  values (v_creator_id, 'campaign_created', v_campaign_id);

  perform public.check_achievements(v_creator_id);
  perform public.log_audit_event(v_creator_id, 'campaign.created', 'campaign', v_campaign_id, null,
    jsonb_build_object('reward', p_reward, 'desired_completions', p_desired_completions, 'total_budget', v_total_budget),
    null);

  return v_campaign_id;
end;
$$;

create or replace function public.set_campaign_pause_state(p_campaign_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_campaign public.campaigns;
begin
  if v_actor_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = p_campaign_id for update;

  if not found then
    raise exception 'NOT_FOUND: campaign not found' using errcode = 'P0001';
  end if;

  if v_campaign.creator_id <> v_actor_id and not public.is_admin() then
    raise exception 'FORBIDDEN: not the campaign owner' using errcode = 'P0001';
  end if;

  if v_campaign.status not in ('active', 'paused') then
    raise exception 'CAMPAIGN_%: campaign is not active or paused', upper(v_campaign.status::text)
      using errcode = 'P0001';
  end if;

  -- The case expression's branches are untyped string literals with no
  -- other typed operand to anchor on, so Postgres resolves the whole
  -- expression as text - and text has no implicit cast to the
  -- campaign_status enum, so the explicit cast below is required, not
  -- decorative (confirmed by scripts/test/002_open_tasks_view_test.sql,
  -- which is the first test to actually call this function).
  update public.campaigns
  set status = (case when p_paused then 'paused' else 'active' end)::campaign_status
  where id = p_campaign_id;

  perform public.log_audit_event(v_actor_id,
    case when p_paused then 'campaign.paused' else 'campaign.resumed' end,
    'campaign', p_campaign_id, to_jsonb(v_campaign.status), null, null);
end;
$$;

create or replace function public.cancel_campaign(p_campaign_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_campaign public.campaigns;
begin
  if v_actor_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = p_campaign_id for update;

  if not found then
    raise exception 'NOT_FOUND: campaign not found' using errcode = 'P0001';
  end if;

  if v_campaign.creator_id <> v_actor_id and not public.is_admin() then
    raise exception 'FORBIDDEN: not the campaign owner' using errcode = 'P0001';
  end if;

  if v_campaign.status in ('completed', 'cancelled') then
    raise exception 'CAMPAIGN_%: campaign cannot be cancelled from its current state', upper(v_campaign.status::text)
      using errcode = 'P0001';
  end if;

  update public.campaigns set status = 'cancelled' where id = p_campaign_id;

  if v_campaign.remaining_budget > 0 then
    perform public.write_ledger_entry(v_campaign.creator_id, v_campaign.remaining_budget, 'campaign_refund',
      'Refund for cancelled campaign', null, p_campaign_id, v_actor_id);
  end if;

  insert into public.notifications (user_id, type, title, body, related_campaign_id, dedup_key)
  values (v_campaign.creator_id, 'campaign_cancelled', 'Campaign cancelled',
    coalesce(p_reason, ''), p_campaign_id, 'campaign:' || p_campaign_id || ':cancelled');

  perform public.log_audit_event(v_actor_id, 'campaign.cancelled', 'campaign', p_campaign_id,
    to_jsonb(v_campaign), jsonb_build_object('refunded', v_campaign.remaining_budget), p_reason);
end;
$$;

-- =========================================================== VERIFICATION

create or replace function public.submit_task_verification(
  p_task_id uuid,
  p_proof_url text,
  p_proof_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.tasks;
  v_campaign public.campaigns;
  v_completion_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'TASK_NOT_FOUND: task not found' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  if v_campaign.creator_id = v_user_id then
    raise exception 'SELF_TASK_FORBIDDEN: cannot complete your own task' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = v_user_id and status = 'active') then
    raise exception 'FORBIDDEN: account is not active' using errcode = 'P0001';
  end if;

  if v_campaign.status <> 'active' then
    raise exception 'TASK_NOT_AVAILABLE: campaign is not active' using errcode = 'P0001';
  end if;

  if v_campaign.completed_count >= v_campaign.desired_completions or v_campaign.remaining_budget < v_campaign.reward then
    raise exception 'TASK_NOT_AVAILABLE: no budget or completion slots remaining' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.task_completions where task_id = p_task_id and user_id = v_user_id) then
    raise exception 'TASK_ALREADY_COMPLETED: you have already submitted this task' using errcode = 'P0001';
  end if;

  insert into public.task_completions (task_id, user_id, status, reward_amount)
  values (p_task_id, v_user_id, 'pending', v_campaign.reward)
  returning id into v_completion_id;

  insert into public.task_verifications (completion_id, proof_url, proof_text)
  values (v_completion_id, p_proof_url, p_proof_text);

  insert into public.activity (user_id, type, related_task_id, related_campaign_id)
  values (v_user_id, 'verification_submitted', p_task_id, v_campaign.id);

  return v_completion_id;
end;
$$;

-- The atomic reward engine (spec sections 13, 43, 44). Internal-only: no
-- EXECUTE grant to authenticated (see bottom of file), reachable only
-- from review_task_verification(), which has already verified the
-- caller is the campaign owner or an admin. Locks the campaign row first
-- so concurrent approvals against the same budget serialize; the second
-- of two simultaneous requests for the last budget slot will see the
-- reduced remaining_budget and fail safely with INSUFFICIENT_BUDGET
-- rather than ever taking the budget negative.
create or replace function public.reward_task_completion(p_completion_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion public.task_completions;
  v_task public.tasks;
  v_campaign public.campaigns;
  v_new_status campaign_status;
begin
  select * into v_completion from public.task_completions where id = p_completion_id for update;
  if not found then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  if v_completion.status <> 'pending' then
    raise exception 'VERIFICATION_ALREADY_REVIEWED: this verification was already reviewed'
      using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = v_completion.task_id;
  select * into v_campaign from public.campaigns where id = v_task.campaign_id for update;

  if v_campaign.status not in ('active', 'paused') then
    raise exception 'CAMPAIGN_%: campaign is no longer reviewable', upper(v_campaign.status::text)
      using errcode = 'P0001';
  end if;

  if v_campaign.remaining_budget < v_completion.reward_amount then
    raise exception 'INSUFFICIENT_BUDGET: campaign does not have enough remaining budget'
      using errcode = 'P0001';
  end if;

  v_new_status := v_campaign.status;
  if v_campaign.completed_count + 1 >= v_campaign.desired_completions
     or v_campaign.remaining_budget - v_completion.reward_amount = 0 then
    v_new_status := 'completed';
  end if;

  update public.campaigns
  set remaining_budget = remaining_budget - v_completion.reward_amount,
      completed_count = completed_count + 1,
      status = v_new_status
  where id = v_campaign.id;

  update public.task_completions
  set status = 'approved', reviewed_at = now(), reviewed_by = p_actor_id
  where id = p_completion_id;

  perform public.write_ledger_entry(v_completion.user_id, v_completion.reward_amount, 'task_reward',
    'Task reward', v_task.id, v_campaign.id, p_actor_id);

  perform public.award_xp(v_completion.user_id, 10);

  insert into public.activity (user_id, type, related_task_id, related_campaign_id)
  values (v_completion.user_id, 'task_completed', v_task.id, v_campaign.id);

  insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
  values (v_completion.user_id, 'verification_approved', 'Verification approved',
    'Your submission was approved and you earned ' || v_completion.reward_amount || ' credits.',
    v_task.id, v_campaign.id, 'completion:' || p_completion_id || ':approved');

  if v_new_status = 'completed' then
    insert into public.notifications (user_id, type, title, body, related_campaign_id, dedup_key)
    values (v_campaign.creator_id, 'campaign_completed', 'Campaign completed',
      v_campaign.title || ' has reached its completion target.', v_campaign.id,
      'campaign:' || v_campaign.id || ':completed');

    insert into public.activity (user_id, type, related_campaign_id)
    values (v_campaign.creator_id, 'campaign_completed', v_campaign.id);
  end if;

  perform public.check_achievements(v_completion.user_id);
  perform public.try_reward_referral(v_completion.user_id);

  perform public.log_audit_event(p_actor_id, 'verification.approved', 'task_completion', p_completion_id,
    null, jsonb_build_object('reward', v_completion.reward_amount), null);
end;
$$;

create or replace function public.review_task_verification(
  p_completion_id uuid,
  p_decision text,
  p_review_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_completion public.task_completions;
  v_task public.tasks;
  v_campaign public.campaigns;
begin
  if v_actor_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION_ERROR: decision must be approved or rejected' using errcode = 'P0001';
  end if;

  select * into v_completion from public.task_completions where id = p_completion_id;
  if not found then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = v_completion.task_id;
  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  if v_campaign.creator_id <> v_actor_id and not public.is_admin() then
    raise exception 'FORBIDDEN: not authorized to review this verification' using errcode = 'P0001';
  end if;

  if v_completion.status <> 'pending' then
    raise exception 'VERIFICATION_ALREADY_REVIEWED: this verification was already reviewed'
      using errcode = 'P0001';
  end if;

  update public.task_verifications set review_notes = p_review_notes where completion_id = p_completion_id;

  if p_decision = 'approved' then
    perform public.reward_task_completion(p_completion_id, v_actor_id);
  else
    update public.task_completions
    set status = 'rejected', reviewed_at = now(), reviewed_by = v_actor_id
    where id = p_completion_id;

    insert into public.activity (user_id, type, related_task_id, related_campaign_id)
    values (v_completion.user_id, 'verification_reviewed', v_task.id, v_campaign.id);

    insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
    values (v_completion.user_id, 'verification_rejected', 'Verification rejected',
      coalesce(p_review_notes, ''), v_task.id, v_campaign.id, 'completion:' || p_completion_id || ':rejected');

    perform public.log_audit_event(v_actor_id, 'verification.rejected', 'task_completion', p_completion_id,
      null, null, p_review_notes);
  end if;
end;
$$;

-- ================================================================= ADMIN

create or replace function public.admin_update_user(
  p_target_user_id uuid,
  p_new_role user_role,
  p_new_status user_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target public.profiles;
  v_admin_count integer;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;

  select * into v_target from public.profiles where id = p_target_user_id for update;
  if not found then
    raise exception 'NOT_FOUND: user not found' using errcode = 'P0001';
  end if;

  if v_target.role = 'admin' and p_new_role = 'user' then
    select count(*) into v_admin_count from public.profiles where role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'FORBIDDEN: cannot demote the last administrator' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
  set role = p_new_role, status = p_new_status
  where id = p_target_user_id;

  perform public.log_audit_event(v_admin_id, 'user.updated', 'user', p_target_user_id,
    jsonb_build_object('role', v_target.role, 'status', v_target.status),
    jsonb_build_object('role', p_new_role, 'status', p_new_status), p_reason);
end;
$$;

create or replace function public.admin_credit_adjustment(
  p_target_user_id uuid,
  p_amount integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_previous_balance integer;
  v_new_balance integer;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION_ERROR: a reason is required for credit adjustments' using errcode = 'P0001';
  end if;

  select credits into v_previous_balance from public.profiles where id = p_target_user_id;
  if not found then
    raise exception 'NOT_FOUND: user not found' using errcode = 'P0001';
  end if;

  v_new_balance := public.write_ledger_entry(p_target_user_id, p_amount, 'admin_adjustment', p_reason,
    null, null, v_admin_id);

  perform public.log_audit_event(v_admin_id, 'credit.admin_adjustment', 'user', p_target_user_id,
    jsonb_build_object('previous_balance', v_previous_balance),
    jsonb_build_object('amount', p_amount, 'new_balance', v_new_balance), p_reason);
end;
$$;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_report public.reports;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;

  if p_decision not in ('resolved', 'dismissed') then
    raise exception 'VALIDATION_ERROR: decision must be resolved or dismissed' using errcode = 'P0001';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if not found then
    raise exception 'NOT_FOUND: report not found' using errcode = 'P0001';
  end if;

  update public.reports
  set status = p_decision::report_status, resolved_by = v_admin_id, resolved_at = now()
  where id = p_report_id;

  perform public.log_audit_event(v_admin_id, 'report.' || p_decision, 'report', p_report_id,
    to_jsonb(v_report.status), jsonb_build_object('decision', p_decision), p_note);
end;
$$;

-- ======================================================= EXECUTE GRANTS
-- Deny-by-default: revoke the implicit PUBLIC execute every new Postgres
-- function gets, then grant back only the intended entry points to
-- authenticated. Internal helpers (write_ledger_entry, award_xp,
-- check_achievements, try_reward_referral, log_audit_event,
-- reward_task_completion, handle_new_user and the trigger functions)
-- receive no client grant at all - reachable only by being called from
-- inside another SECURITY DEFINER function.

revoke execute on function
  public.calculate_level(integer),
  public.award_xp(uuid, integer),
  public.write_ledger_entry(uuid, integer, ledger_transaction_type, text, uuid, uuid, uuid),
  public.check_achievements(uuid),
  public.claim_referral(text),
  public.try_reward_referral(uuid),
  public.create_campaign(text, text, task_platform, task_type, text, text, verification_method, integer, integer),
  public.set_campaign_pause_state(uuid, boolean),
  public.cancel_campaign(uuid, text),
  public.submit_task_verification(uuid, text, text),
  public.reward_task_completion(uuid, uuid),
  public.review_task_verification(uuid, text, text),
  public.admin_update_user(uuid, user_role, user_status, text),
  public.admin_credit_adjustment(uuid, integer, text),
  public.admin_resolve_report(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.claim_referral(text) to authenticated;
grant execute on function public.create_campaign(text, text, task_platform, task_type, text, text, verification_method, integer, integer) to authenticated;
grant execute on function public.set_campaign_pause_state(uuid, boolean) to authenticated;
grant execute on function public.cancel_campaign(uuid, text) to authenticated;
grant execute on function public.submit_task_verification(uuid, text, text) to authenticated;
grant execute on function public.review_task_verification(uuid, text, text) to authenticated;
grant execute on function public.admin_update_user(uuid, user_role, user_status, text) to authenticated;
grant execute on function public.admin_credit_adjustment(uuid, integer, text) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
