-- 021_trust_and_economy.sql
-- Ten rules that close loopholes in the credit economy and make reviews
-- fairer for both sides.
--
--   1. Referral bonus. Paid on the friend's first approval that a real
--      person made - not the referrer, not on the referrer's own campaign
--      or on a campaign of someone the referrer brought in, never an
--      automatic approval - and at most 5 bonuses per referrer per day.
--      A referral code can only be claimed before one's first approval.
--   2. Places are held at submission. Sending proof reserves one of the
--      campaign's places and its reward (campaigns.reserved_count,
--      task_completions.holds_slot), so a campaign can never collect more
--      proofs than it can pay. A rejection or expiry frees the place. A
--      cancelled campaign keeps the money for proofs already sent and
--      refunds the rest; whatever those proofs don't use goes back to the
--      creator later.
--   3. The creator is notified when proof arrives (one unread notice per
--      campaign at a time, not one per proof).
--   4. The account used. Tasks done from an account (follow, like,
--      comment, subscribe, share, repost, save, join on a social platform)
--      need the member's linked account for that platform; its handle is
--      kept with the proof so the creator can check it.
--   5. Doer reputation. doer_review_stats() shows reviewers a member's
--      track record. A member may have at most 5 + 5 x level proofs (30 at
--      most) waiting at once. Members with 5 or more rejected or reversed
--      proofs that make up 30% or more of their reviewed ones are not
--      approved automatically: their proofs wait for a person and expire
--      after 3 days. "Often rejected" counts only proofs a person looked
--      at: automatic approvals don't dilute it.
--   6. Appeals. A rejected proof can be appealed once, within 7 days; an
--      admin either approves and pays it (admin_overturn_rejection) or
--      keeps the rejection. The reward comes from a free place in the
--      campaign or, when there is none (full or cancelled), from the
--      creator who rejected it.
--   7. Undone actions. Within 7 days of approving, a creator can report
--      that the member undid the action (unfollowed, deleted the like...);
--      an admin can take the reward back and return it to the creator
--      (admin_reverse_reward). The proof is then "reversed".
--   8. Reused screenshots. The API records each upload's SHA-256
--      (proof_images); the same image can be used as proof only once.
--   9. Welcome bonus. 10 credits, once, after approvals from 3 different
--      creators (by a person, not automatic, none of them connected to the
--      member through referrals).
--  10. Level perks. The waiting-proof limit grows with level; reviewers
--      see the member's level next to their proof.
--
-- Also: a review locks the proof, so an approval and a rejection can never
-- both land on it; deleting a member frees the places their waiting proofs
-- held; log_audit_event() is closed to clients (it was callable since 013).
--
-- Enum values added here are only ever compared as text inside this file
-- (a new enum value can't be used in the transaction that adds it), so the
-- whole file can run in a single transaction - the Supabase SQL editor
-- does exactly that. Safe to run more than once.

-- ═════════════════════════════════════════════════════════════ enums

alter type public.completion_status add value if not exists 'reversed';
alter type public.notification_type add value if not exists 'proof_submitted';
alter type public.notification_type add value if not exists 'reward_reversed';
alter type public.report_type add value if not exists 'proof_appeal';
alter type public.report_type add value if not exists 'unfollowed';

-- ═══════════════════════════════════════════════════════════ columns

alter table public.campaigns add column if not exists reserved_count integer not null default 0;
alter table public.campaigns drop constraint if exists reserved_count_non_negative;
alter table public.campaigns add constraint reserved_count_non_negative check (reserved_count >= 0);

comment on column public.campaigns.reserved_count is
  'Places held by proofs waiting for review. Free places = desired_completions - completed_count - reserved_count.';

alter table public.task_completions add column if not exists holds_slot boolean not null default false;

comment on column public.task_completions.holds_slot is
  'This pending proof holds one of its campaign''s places (and its reward) until it is reviewed or expires.';

-- The account the member did the task from, copied when the proof is sent
-- (a later rename or unlink doesn't change what the creator checked).
alter table public.task_verifications add column if not exists account_username text;
alter table public.task_verifications add column if not exists account_url text;
alter table public.task_verifications add column if not exists proof_image_sha text;

alter table public.task_verifications drop constraint if exists proof_image_sha_format;
alter table public.task_verifications add constraint proof_image_sha_format check (
  proof_image_sha is null or proof_image_sha ~ '^[0-9a-f]{64}$'
);

-- One image, one proof - also when two submissions race each other.
create unique index if not exists idx_task_verifications_image_sha
  on public.task_verifications (proof_image_sha) where proof_image_sha is not null;

alter table public.reports add column if not exists related_completion_id uuid
  references public.task_completions(id) on delete set null;

create index if not exists idx_task_verifications_image_path
  on public.task_verifications (proof_image_path) where proof_image_path is not null;

create index if not exists idx_reports_completion
  on public.reports (related_completion_id) where related_completion_id is not null;

-- Appeals and undone-action reports always name the proof they are about.
alter table public.reports drop constraint if exists completion_reports_need_completion;
alter table public.reports add constraint completion_reports_need_completion check (
  report_type::text not in ('proof_appeal', 'unfollowed') or related_completion_id is not null
);

-- No more than one welcome bonus per member, whatever happens.
create unique index if not exists idx_credit_ledger_one_signup_bonus
  on public.credit_ledger (user_id) where type = 'signup_bonus';

-- ═══════════════════════════════════════════════════ uploaded images

create table if not exists public.proof_images (
  path text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sha256 text not null,
  created_at timestamptz not null default now(),
  constraint proof_images_sha_format check (sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.proof_images is
  'Every proof screenshot the API stored, with its SHA-256. Written only by the API (service role); read by submit_task_verification().';

create index if not exists idx_proof_images_sha on public.proof_images (sha256);

alter table public.proof_images enable row level security;
revoke all on public.proof_images from anon, authenticated;

-- ═════════════════════════════════════════════════ backfill places

-- Proofs already waiting when this runs take the places still free in
-- their campaign, oldest first. Any beyond that (a campaign that collected
-- more proofs than places, which the old rules allowed) hold nothing:
-- they are paid only if a place is free when they are approved.
with room as (
  select c.id as campaign_id,
         greatest(0, least(c.desired_completions - c.completed_count, c.remaining_budget / c.reward)
           - (select count(*) from public.task_completions h
              join public.tasks ht on ht.id = h.task_id
              where ht.campaign_id = c.id and h.status = 'pending' and h.holds_slot)) as free
  from public.campaigns c
  where c.status in ('active', 'paused')
),
ranked as (
  select tc.id, r.free,
         row_number() over (partition by t.campaign_id order by tc.created_at, tc.id) as n
  from public.task_completions tc
  join public.tasks t on t.id = tc.task_id
  join room r on r.campaign_id = t.campaign_id
  where tc.status = 'pending' and not tc.holds_slot
)
update public.task_completions tc
set holds_slot = true
from ranked
where ranked.id = tc.id and ranked.n <= ranked.free;

update public.campaigns c
set reserved_count = sub.held
from (
  select c2.id, (select count(*) from public.task_completions tc
                 join public.tasks t on t.id = tc.task_id
                 where t.campaign_id = c2.id and tc.status = 'pending' and tc.holds_slot)::integer as held
  from public.campaigns c2
) sub
where sub.id = c.id and c.reserved_count <> sub.held;

-- A cancelled campaign keeps only the money held for proofs still waiting.
-- Campaigns cancelled before this migration were refunded in full at the
-- time, so their remaining budget is set to what is really left: nothing.
update public.campaigns
set remaining_budget = reward * reserved_count
where status = 'cancelled' and remaining_budget <> reward * reserved_count;

alter table public.campaigns drop constraint if exists reserved_within_target;
alter table public.campaigns add constraint reserved_within_target
  check (completed_count + reserved_count <= desired_completions);

-- ═════════════════════════════════════════════════════════ helpers

-- How many proofs a member may have waiting for review at once.
create or replace function public.pending_proof_limit(p_level integer)
returns integer
language sql
immutable
as $$
  select least(5 + 5 * greatest(coalesce(p_level, 1), 1), 30);
$$;

-- False for members whose proofs are often rejected or reversed: 5 or more
-- of them, and 30% or more of the proofs a person looked at. Automatic
-- approvals (24 h timeout, link clicks) are left out of the total, so a
-- pile of quick link-click visits can't dilute the rejections.
create or replace function public.doer_is_trusted(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select bad < 5 or bad * 10 < total * 3
  from (
    select count(*) filter (where status::text in ('rejected', 'reversed')) as bad,
           count(*) filter (where status::text in ('rejected', 'reversed')
                              or (status::text = 'approved' and not auto_approved)) as total
    from public.task_completions
    where user_id = p_user_id
  ) s;
$$;

-- Frees the place a pending proof held. On a campaign that is no longer
-- running the reward kept for it goes back to the creator.
create or replace function public.release_completion_slot(p_completion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion public.task_completions;
  v_campaign public.campaigns;
  v_refund integer;
begin
  select * into v_completion from public.task_completions where id = p_completion_id for update;
  if not found or not v_completion.holds_slot then
    return;
  end if;

  select c.* into v_campaign
  from public.campaigns c
  join public.tasks t on t.campaign_id = c.id
  where t.id = v_completion.task_id
  for update of c;

  update public.task_completions set holds_slot = false where id = p_completion_id;

  if v_campaign.status in ('active', 'paused') then
    update public.campaigns set reserved_count = greatest(reserved_count - 1, 0) where id = v_campaign.id;
    return;
  end if;

  v_refund := least(v_completion.reward_amount, v_campaign.remaining_budget);
  update public.campaigns
  set reserved_count = greatest(reserved_count - 1, 0),
      remaining_budget = remaining_budget - v_refund
  where id = v_campaign.id;

  if v_refund > 0 then
    perform public.write_ledger_entry(v_campaign.creator_id, v_refund, 'campaign_refund',
      'Refund for cancelled campaign', v_completion.task_id, v_campaign.id, null);
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════ welcome bonus

-- Distinct creators who approved the member's proofs by hand, leaving out
-- anyone tied to the member through referrals (the member's referrer,
-- people the member or that referrer brought in).
create or replace function public.starter_bonus_creators(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct c.creator_id)::integer
  from public.task_completions tc
  join public.tasks t on t.id = tc.task_id
  join public.campaigns c on c.id = t.campaign_id
  join public.profiles creator on creator.id = c.creator_id
  join public.profiles me on me.id = p_user_id
  where tc.user_id = p_user_id
    and tc.status = 'approved'
    and not tc.auto_approved
    and tc.reviewed_by is not null
    and c.creator_id is distinct from me.referred_by
    and creator.referred_by is distinct from p_user_id
    and (me.referred_by is null or creator.referred_by is distinct from me.referred_by);
$$;

create or replace function public.try_starter_bonus(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bonus constant integer := 10;
  v_needed constant integer := 3;
begin
  if exists (select 1 from public.credit_ledger where user_id = p_user_id and type = 'signup_bonus') then
    return;
  end if;

  if public.starter_bonus_creators(p_user_id) < v_needed then
    return;
  end if;

  -- Serialize per member, then check again.
  perform 1 from public.profiles where id = p_user_id for update;
  if exists (select 1 from public.credit_ledger where user_id = p_user_id and type = 'signup_bonus') then
    return;
  end if;

  perform public.write_ledger_entry(p_user_id, v_bonus, 'signup_bonus', 'Welcome bonus', null, null, null);

  insert into public.notifications (user_id, type, title, body, dedup_key)
  values (p_user_id, 'reward_received', 'Welcome bonus',
    'You earned 10 credits for completing tasks from 3 different creators.', 'starter-bonus')
  on conflict do nothing;
end;
$$;

-- The caller's progress toward the welcome bonus.
create or replace function public.get_starter_bonus()
returns table (creators_done integer, creators_needed integer, amount integer, granted_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select least(public.starter_bonus_creators(auth.uid()), 3), 3, 10,
         (select min(created_at) from public.credit_ledger where user_id = auth.uid() and type = 'signup_bonus')
  where auth.uid() is not null;
$$;

-- ═════════════════════════════════════════════════════ referral bonus

create or replace function public.try_reward_referral(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral record;
  v_bonus constant integer := 20;
  v_daily_cap constant integer := 5;
begin
  select * into v_referral from public.referrals
  where referred_id = p_user_id and status = 'pending'
  for update;

  if not found then
    return;
  end if;

  -- An approval only counts when a real person, unconnected to the
  -- referrer, approved it.
  if not exists (
    select 1
    from public.task_completions tc
    join public.tasks t on t.id = tc.task_id
    join public.campaigns c on c.id = t.campaign_id
    join public.profiles creator on creator.id = c.creator_id
    where tc.user_id = p_user_id
      and tc.status = 'approved'
      and not tc.auto_approved
      and tc.reviewed_by is not null
      and tc.reviewed_by <> v_referral.referrer_id
      and c.creator_id <> v_referral.referrer_id
      and creator.referred_by is distinct from v_referral.referrer_id
  ) then
    return;
  end if;

  -- At most 5 bonuses per referrer per day; the rest wait for the
  -- friend's next approval. Counted under the referrer's row lock.
  perform 1 from public.profiles where id = v_referral.referrer_id for update;
  if (select count(*) from public.referrals
      where referrer_id = v_referral.referrer_id and status = 'rewarded'
        and reward_issued_at > now() - interval '1 day') >= v_daily_cap then
    return;
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
    'A friend you referred just completed their first task.', 'referral:' || v_referral.id)
  on conflict do nothing;

  insert into public.activity (user_id, type, metadata)
  values (v_referral.referrer_id, 'referral_joined', jsonb_build_object('referred_id', p_user_id));
end;
$$;

-- ═══════════════════════════════════════════════════════ reward engine

-- As in 015, plus places: a proof that holds a place is paid from it (also
-- after its campaign was cancelled); any other needs a free place at the
-- moment it is approved.
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

  if v_completion.holds_slot then
    if v_campaign.status not in ('active', 'paused', 'cancelled') then
      raise exception 'CAMPAIGN_%: campaign is no longer reviewable', upper(v_campaign.status::text)
        using errcode = 'P0001';
    end if;
    if v_campaign.remaining_budget < v_completion.reward_amount then
      raise exception 'INSUFFICIENT_BUDGET: campaign does not have enough remaining budget'
        using errcode = 'P0001';
    end if;
  else
    if v_campaign.status not in ('active', 'paused') then
      raise exception 'CAMPAIGN_%: campaign is no longer reviewable', upper(v_campaign.status::text)
        using errcode = 'P0001';
    end if;
    if v_campaign.completed_count + v_campaign.reserved_count >= v_campaign.desired_completions
       or v_campaign.remaining_budget - v_campaign.reward * v_campaign.reserved_count < v_completion.reward_amount then
      raise exception 'INSUFFICIENT_BUDGET: campaign does not have enough remaining budget'
        using errcode = 'P0001';
    end if;
  end if;

  v_new_status := v_campaign.status;
  if v_campaign.status in ('active', 'paused')
     and (v_campaign.completed_count + 1 >= v_campaign.desired_completions
          or v_campaign.remaining_budget - v_completion.reward_amount = 0) then
    v_new_status := 'completed';
  end if;

  update public.campaigns
  set remaining_budget = remaining_budget - v_completion.reward_amount,
      completed_count = completed_count + 1,
      reserved_count = reserved_count - (case when v_completion.holds_slot then 1 else 0 end),
      status = v_new_status
  where id = v_campaign.id;

  if v_new_status = 'completed' and v_campaign.status <> 'completed' then
    insert into public.notifications (user_id, type, title, body, related_campaign_id, dedup_key)
    values (v_campaign.creator_id, 'campaign_completed', 'Campaign completed',
      v_campaign.title || ' has reached its completion target.', v_campaign.id,
      'campaign:' || v_campaign.id || ':completed')
    on conflict do nothing;

    insert into public.activity (user_id, type, related_campaign_id)
    values (v_campaign.creator_id, 'campaign_completed', v_campaign.id);
  end if;

  perform public.pay_approved_completion(p_completion_id, p_actor_id);
end;
$$;

-- The member's side of an approval, whoever pays it: marks the proof
-- approved, credits the reward, XP, notices, achievements and bonuses.
-- The caller has locked the proof and taken the money from somewhere.
create or replace function public.pay_approved_completion(p_completion_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion public.task_completions;
  v_task public.tasks;
begin
  select * into v_completion from public.task_completions where id = p_completion_id;
  select * into v_task from public.tasks where id = v_completion.task_id;

  update public.task_completions
  set status = 'approved', reviewed_at = now(), reviewed_by = p_actor_id, holds_slot = false
  where id = p_completion_id;

  perform public.write_ledger_entry(v_completion.user_id, v_completion.reward_amount, 'task_reward',
    'Task reward', v_task.id, v_task.campaign_id, p_actor_id);

  perform public.award_xp(v_completion.user_id, 10);

  insert into public.activity (user_id, type, related_task_id, related_campaign_id)
  values (v_completion.user_id, 'task_completed', v_task.id, v_task.campaign_id);

  insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
  values (v_completion.user_id, 'verification_approved', 'Verification approved',
    'Your submission was approved and you earned ' || v_completion.reward_amount || ' credits.',
    v_task.id, v_task.campaign_id, 'completion:' || p_completion_id || ':approved')
  on conflict do nothing;

  perform public.check_achievements(v_completion.user_id);
  perform public.try_reward_referral(v_completion.user_id);
  perform public.try_starter_bonus(v_completion.user_id);

  perform public.log_audit_event(p_actor_id, 'verification.approved', 'task_completion', p_completion_id,
    null, jsonb_build_object('reward', v_completion.reward_amount), null);
end;
$$;

-- ═════════════════════════════════════════════════════════ review

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

  -- Locked: an approval and a rejection racing each other (two reviewers,
  -- a double click, the 24 h job) must never both land on one proof.
  select * into v_completion from public.task_completions where id = p_completion_id for update;
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
    perform public.release_completion_slot(p_completion_id);

    update public.task_completions
    set status = 'rejected', reviewed_at = now(), reviewed_by = v_actor_id
    where id = p_completion_id and status = 'pending';
    if not found then
      raise exception 'VERIFICATION_ALREADY_REVIEWED: this verification was already reviewed'
        using errcode = 'P0001';
    end if;

    insert into public.activity (user_id, type, related_task_id, related_campaign_id)
    values (v_completion.user_id, 'verification_reviewed', v_task.id, v_campaign.id);

    insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
    values (v_completion.user_id, 'verification_rejected', 'Verification rejected',
      coalesce(p_review_notes, ''), v_task.id, v_campaign.id, 'completion:' || p_completion_id || ':rejected')
    on conflict do nothing;

    perform public.log_audit_event(v_actor_id, 'verification.rejected', 'task_completion', p_completion_id,
      null, null, p_review_notes);
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════ cancel

-- Refunds what isn't held for proofs already sent; those are still
-- reviewed (or approved automatically) and paid from what was kept.
create or replace function public.cancel_campaign(p_campaign_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_campaign public.campaigns;
  v_kept integer;
  v_refund integer;
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

  v_kept := least(v_campaign.reward * v_campaign.reserved_count, v_campaign.remaining_budget);
  v_refund := v_campaign.remaining_budget - v_kept;

  update public.campaigns
  set status = 'cancelled', remaining_budget = v_kept
  where id = p_campaign_id;

  if v_refund > 0 then
    perform public.write_ledger_entry(v_campaign.creator_id, v_refund, 'campaign_refund',
      'Refund for cancelled campaign', null, p_campaign_id, v_actor_id);
  end if;

  insert into public.notifications (user_id, type, title, body, related_campaign_id, dedup_key)
  values (v_campaign.creator_id, 'campaign_cancelled', 'Campaign cancelled',
    coalesce(p_reason, ''), p_campaign_id, 'campaign:' || p_campaign_id || ':cancelled')
  on conflict do nothing;

  perform public.log_audit_event(v_actor_id, 'campaign.cancelled', 'campaign', p_campaign_id,
    to_jsonb(v_campaign), jsonb_build_object('refunded', v_refund, 'kept_for_waiting_proofs', v_kept), p_reason);
end;
$$;

-- ═════════════════════════════════════════════════════════ submit

-- Same rules as 020, plus: the account used (for tasks done from one), the
-- waiting-proof limit, one place held per proof, no reused screenshots,
-- and a notice to the creator.
drop function if exists public.submit_task_verification(uuid, text, text, text);

create or replace function public.submit_task_verification(
  p_task_id uuid,
  p_proof_url text,
  p_proof_text text,
  p_proof_image_path text default null,
  p_social_profile_id uuid default null
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
  v_profile public.profiles;
  v_account public.social_profiles;
  v_sha text;
  v_waiting integer;
  v_completion_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'TASK_NOT_FOUND: task not found' using errcode = 'P0001';
  end if;

  if v_task.verification_method = 'link_click' then
    raise exception 'VALIDATION_ERROR: this task is completed by opening its link' using errcode = 'P0001';
  end if;

  if p_proof_url is null and p_proof_text is null and p_proof_image_path is null then
    raise exception 'VALIDATION_ERROR: add a link, a note or a screenshot as proof' using errcode = 'P0001';
  end if;

  if p_proof_image_path is not null and split_part(p_proof_image_path, '/', 1) <> v_user_id::text then
    raise exception 'VALIDATION_ERROR: invalid screenshot' using errcode = 'P0001';
  end if;

  -- Locked: places are counted and taken under this lock.
  select * into v_campaign from public.campaigns where id = v_task.campaign_id for update;

  if v_campaign.creator_id = v_user_id then
    raise exception 'SELF_TASK_FORBIDDEN: cannot complete your own task' using errcode = 'P0001';
  end if;

  -- Locked: the waiting-proof count below can't be raced past.
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found or v_profile.status <> 'active' then
    raise exception 'FORBIDDEN: account is not active' using errcode = 'P0001';
  end if;

  if v_campaign.status <> 'active' then
    raise exception 'TASK_NOT_AVAILABLE: campaign is not active' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.task_completions where task_id = p_task_id and user_id = v_user_id) then
    raise exception 'TASK_ALREADY_COMPLETED: you have already submitted this task' using errcode = 'P0001';
  end if;

  if v_campaign.completed_count + v_campaign.reserved_count >= v_campaign.desired_completions
     or v_campaign.remaining_budget < v_campaign.reward * (v_campaign.reserved_count + 1) then
    raise exception 'TASK_NOT_AVAILABLE: no budget or completion slots remaining' using errcode = 'P0001';
  end if;

  select count(*) into v_waiting from public.task_completions where user_id = v_user_id and status = 'pending';
  if v_waiting >= public.pending_proof_limit(v_profile.level) then
    raise exception 'PENDING_LIMIT: too many of your proofs are waiting for review' using errcode = 'P0001';
  end if;

  -- The account used: required for tasks done from an account on a
  -- social platform, optional (but checked) everywhere else.
  if p_social_profile_id is not null then
    select * into v_account from public.social_profiles
    where id = p_social_profile_id and user_id = v_user_id and platform::text = v_task.platform::text;
    if not found then
      raise exception 'ACCOUNT_REQUIRED: that account is not linked to your profile' using errcode = 'P0001';
    end if;
  elsif v_task.platform <> 'other'
        and v_task.task_type in ('follow', 'like', 'comment', 'subscribe', 'share', 'repost', 'save', 'join') then
    raise exception 'ACCOUNT_REQUIRED: choose the account you did this task from' using errcode = 'P0001';
  end if;

  if p_proof_image_path is not null then
    select sha256 into v_sha from public.proof_images where path = p_proof_image_path and user_id = v_user_id;
    if exists (select 1 from public.task_verifications where proof_image_path = p_proof_image_path)
       or (v_sha is not null and exists (select 1 from public.task_verifications where proof_image_sha = v_sha)) then
      raise exception 'DUPLICATE_PROOF: this screenshot was already used as proof' using errcode = 'P0001';
    end if;
  end if;

  insert into public.task_completions (task_id, user_id, status, reward_amount, holds_slot)
  values (p_task_id, v_user_id, 'pending', v_campaign.reward, true)
  returning id into v_completion_id;

  update public.campaigns set reserved_count = reserved_count + 1 where id = v_campaign.id;

  begin
    insert into public.task_verifications (completion_id, proof_url, proof_text, proof_image_path,
      proof_image_sha, account_username, account_url)
    values (v_completion_id, p_proof_url, p_proof_text, p_proof_image_path,
      v_sha, v_account.username, v_account.profile_url);
  exception when unique_violation then
    -- the same image sent twice at the same moment
    raise exception 'DUPLICATE_PROOF: this screenshot was already used as proof' using errcode = 'P0001';
  end;

  insert into public.activity (user_id, type, related_task_id, related_campaign_id)
  values (v_user_id, 'verification_submitted', p_task_id, v_campaign.id);

  -- One unread notice per campaign is enough, however many proofs arrive.
  if not exists (
    select 1 from public.notifications
    where user_id = v_campaign.creator_id and related_campaign_id = v_campaign.id
      and type = 'proof_submitted' and read_at is null
  ) then
    insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id)
    values (v_campaign.creator_id, 'proof_submitted', 'New proof to review',
      'Someone sent proof for ' || v_campaign.title || '. Review it within 24 hours or it is approved automatically.',
      p_task_id, v_campaign.id);
  end if;

  return v_completion_id;
end;
$$;

-- ═══════════════════════════════════════════════════════ link clicks

-- As in 020, counting held places.
create or replace function public.check_link_click_task(p_task_id uuid, p_user_id uuid)
returns public.campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_campaign public.campaigns;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'TASK_NOT_FOUND: task not found' using errcode = 'P0001';
  end if;

  if v_task.verification_method <> 'link_click' then
    raise exception 'VALIDATION_ERROR: this task needs proof, not a link click' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  if v_campaign.creator_id = p_user_id then
    raise exception 'SELF_TASK_FORBIDDEN: cannot complete your own task' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'FORBIDDEN: account is not active' using errcode = 'P0001';
  end if;

  if v_campaign.status <> 'active' then
    raise exception 'TASK_NOT_AVAILABLE: campaign is not active' using errcode = 'P0001';
  end if;

  if v_campaign.completed_count + v_campaign.reserved_count >= v_campaign.desired_completions
     or v_campaign.remaining_budget < v_campaign.reward * (v_campaign.reserved_count + 1) then
    raise exception 'TASK_NOT_AVAILABLE: no budget or completion slots remaining' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.task_completions where task_id = p_task_id and user_id = p_user_id) then
    raise exception 'TASK_ALREADY_COMPLETED: you have already submitted this task' using errcode = 'P0001';
  end if;

  return v_campaign;
end;
$$;

-- ═════════════════════════════════════════════════════ auto-approval

-- As in 020, with two outcomes per overdue proof: members in good standing
-- are approved after 24 hours; members with many rejected or reversed
-- proofs are never approved automatically - their proofs expire after 72.
create or replace function public.auto_approve_overdue_completions(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_done integer := 0;
begin
  for r in
    select tc.id, tc.user_id, tc.task_id, t.campaign_id, tc.created_at
    from public.task_completions tc
    join public.tasks t on t.id = tc.task_id
    where tc.status = 'pending'
      and (tc.created_at < now() - interval '72 hours'
           or (tc.created_at < now() - interval '24 hours' and public.doer_is_trusted(tc.user_id)))
    order by tc.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of tc skip locked
  loop
    if not public.doer_is_trusted(r.user_id) then
      begin
        perform public.release_completion_slot(r.id);
        update public.task_completions set status = 'expired', reviewed_at = now()
        where id = r.id and status = 'pending';

        insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
        values (r.user_id, 'verification_rejected', 'Submission expired',
          'Not reviewed within 3 days. Proofs from accounts with many rejections are not approved automatically.',
          r.task_id, r.campaign_id, 'completion:' || r.id || ':expired')
        on conflict do nothing;

        perform public.log_audit_event(null, 'verification.expired', 'task_completion', r.id, null, null,
          'not reviewed within 72 hours; member not eligible for automatic approval');
        v_done := v_done + 1;
      exception when deadlock_detected or lock_not_available then
        raise warning 'auto-approval skipped completion % (lock conflict), next run retries', r.id;
      end;
      continue;
    end if;

    begin
      update public.task_completions set auto_approved = true where id = r.id;
      perform public.reward_task_completion(r.id, null);
      perform public.log_audit_event(null, 'verification.auto_approved', 'task_completion', r.id,
        null, null, 'not reviewed within 24 hours');
      v_done := v_done + 1;
    exception
      when sqlstate 'P0001' then
        if sqlerrm like 'CAMPAIGN\_%' or sqlerrm like 'INSUFFICIENT\_BUDGET%' then
          perform public.release_completion_slot(r.id);
          update public.task_completions
          set status = 'expired', reviewed_at = now()
          where id = r.id and status = 'pending';

          insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
          values (r.user_id, 'verification_rejected', 'Submission expired',
            'The campaign ended before your proof was reviewed.', r.task_id, r.campaign_id,
            'completion:' || r.id || ':expired')
          on conflict do nothing;

          perform public.log_audit_event(null, 'verification.expired', 'task_completion', r.id, null, null, sqlerrm);
          v_done := v_done + 1;
        else
          raise warning 'auto-approval skipped completion %: %', r.id, sqlerrm;
        end if;
      when deadlock_detected or lock_not_available then
        raise warning 'auto-approval skipped completion % (lock conflict), next run retries', r.id;
    end;
  end loop;

  return v_done;
end;
$$;

-- ═════════════════════════════════════════════════ doer track record

-- What reviewers see next to a proof: how the member's earlier proofs
-- went, and whether they can still be approved automatically. Aggregates
-- only.
create or replace function public.doer_review_stats(p_user_ids uuid[])
returns table (user_id uuid, approved bigint, rejected bigint, reversed bigint, trusted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         count(tc.id) filter (where tc.status::text = 'approved'),
         count(tc.id) filter (where tc.status::text = 'rejected'),
         count(tc.id) filter (where tc.status::text = 'reversed'),
         public.doer_is_trusted(u.id)
  from (select distinct x from unnest(p_user_ids[1:100]) as x) as u(id)
  left join public.task_completions tc on tc.user_id = u.id
  group by u.id;
$$;

-- The caller's waiting proofs against their limit.
create or replace function public.get_my_proof_limits()
returns table (pending_count integer, pending_limit integer, level integer, trusted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.task_completions where user_id = p.id and status = 'pending')::integer,
         public.pending_proof_limit(p.level),
         p.level,
         public.doer_is_trusted(p.id)
  from public.profiles p
  where p.id = auth.uid();
$$;

-- ═══════════════════════════════════════════════════════════ appeals

-- The member asks an admin to look again at a rejected proof: once,
-- within 7 days of the rejection.
create or replace function public.appeal_rejection(p_completion_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_completion public.task_completions;
  v_task public.tasks;
  v_campaign public.campaigns;
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  if p_message is null or length(trim(p_message)) < 10 then
    raise exception 'VALIDATION_ERROR: explain in at least 10 characters' using errcode = 'P0001';
  end if;

  select * into v_completion from public.task_completions where id = p_completion_id for update;
  if not found or v_completion.user_id <> v_user_id then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  if v_completion.status <> 'rejected' then
    raise exception 'VALIDATION_ERROR: only a rejected proof can be appealed' using errcode = 'P0001';
  end if;

  if v_completion.reviewed_at < now() - interval '7 days' then
    raise exception 'VALIDATION_ERROR: appeals are possible within 7 days of the rejection' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.reports
             where related_completion_id = p_completion_id and report_type = 'proof_appeal') then
    raise exception 'VALIDATION_ERROR: this proof was already appealed' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = v_completion.task_id;
  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  insert into public.reports (reporter_id, report_type, description, related_task_id, related_campaign_id,
    related_user_id, related_completion_id)
  values (v_user_id, 'proof_appeal', trim(p_message), v_task.id, v_campaign.id, v_campaign.creator_id, p_completion_id)
  returning id into v_report_id;

  perform public.log_audit_event(v_user_id, 'verification.appealed', 'task_completion', p_completion_id,
    null, jsonb_build_object('report_id', v_report_id), null);

  return v_report_id;
end;
$$;

-- Admin: the rejection was wrong - approve and pay the proof. The reward
-- comes from a free place in the campaign; when there is none (the
-- campaign filled up or was cancelled after the rejection), the creator
-- who rejected it pays it from their balance.
create or replace function public.admin_overturn_rejection(p_completion_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_completion public.task_completions;
  v_task public.tasks;
  v_creator_id uuid;
  v_paid_by text := 'campaign';
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;

  select * into v_completion from public.task_completions where id = p_completion_id for update;
  if not found then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  if v_completion.status <> 'rejected' then
    raise exception 'VALIDATION_ERROR: only a rejected proof can be approved on appeal' using errcode = 'P0001';
  end if;

  update public.task_completions set status = 'pending', holds_slot = false where id = p_completion_id;

  begin
    perform public.reward_task_completion(p_completion_id, v_admin_id);
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'CAMPAIGN\_%' and sqlerrm not like 'INSUFFICIENT\_BUDGET%' then
      raise;
    end if;
    -- No place left to pay it from: the creator who wrongly rejected it pays.
    -- (INSUFFICIENT_CREDITS here stops the whole overturn; nothing changes.)
    select * into v_task from public.tasks where id = v_completion.task_id;
    select creator_id into v_creator_id from public.campaigns where id = v_task.campaign_id;
    perform public.write_ledger_entry(v_creator_id, -v_completion.reward_amount, 'penalty',
      'Rejected proof approved on appeal', v_task.id, v_task.campaign_id, v_admin_id);
    perform public.pay_approved_completion(p_completion_id, v_admin_id);
    v_paid_by := 'creator';
  end;

  update public.reports
  set status = 'resolved', resolved_by = v_admin_id, resolved_at = now()
  where related_completion_id = p_completion_id and report_type = 'proof_appeal' and status <> 'resolved';

  perform public.log_audit_event(v_admin_id, 'verification.overturned', 'task_completion', p_completion_id,
    jsonb_build_object('status', 'rejected'), jsonb_build_object('status', 'approved', 'paid_by', v_paid_by), p_note);
end;
$$;

-- ═════════════════════════════════════════════════════ undone actions

-- The creator reports that the member undid the action they were paid
-- for: once per proof, within 7 days of the approval.
create or replace function public.report_unfollow(p_completion_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_completion public.task_completions;
  v_task public.tasks;
  v_campaign public.campaigns;
  v_report_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  if p_message is null or length(trim(p_message)) < 10 then
    raise exception 'VALIDATION_ERROR: explain in at least 10 characters' using errcode = 'P0001';
  end if;

  select * into v_completion from public.task_completions where id = p_completion_id for update;
  if not found then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = v_completion.task_id;
  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  if v_campaign.creator_id <> v_user_id then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  if v_completion.status <> 'approved' then
    raise exception 'VALIDATION_ERROR: only an approved proof can be reported as undone' using errcode = 'P0001';
  end if;

  if v_task.task_type in ('visit', 'view', 'listen') then
    raise exception 'VALIDATION_ERROR: a visit cannot be undone' using errcode = 'P0001';
  end if;

  if v_completion.reviewed_at < now() - interval '7 days' then
    raise exception 'VALIDATION_ERROR: reports are possible within 7 days of the approval' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.reports
             where related_completion_id = p_completion_id and report_type = 'unfollowed') then
    raise exception 'VALIDATION_ERROR: this proof was already reported' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, report_type, description, related_task_id, related_campaign_id,
    related_user_id, related_completion_id)
  values (v_user_id, 'unfollowed', trim(p_message), v_task.id, v_campaign.id, v_completion.user_id, p_completion_id)
  returning id into v_report_id;

  perform public.log_audit_event(v_user_id, 'verification.reported_undone', 'task_completion', p_completion_id,
    null, jsonb_build_object('report_id', v_report_id), null);

  return v_report_id;
end;
$$;

-- Admin: the action really was undone - take the reward back (as much as
-- the member still has) and return it to the creator.
create or replace function public.admin_reverse_reward(p_completion_id uuid, p_note text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_completion public.task_completions;
  v_task public.tasks;
  v_campaign public.campaigns;
  v_balance integer;
  v_taken integer;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;

  select * into v_completion from public.task_completions where id = p_completion_id for update;
  if not found then
    raise exception 'NOT_FOUND: completion not found' using errcode = 'P0001';
  end if;

  if v_completion.status <> 'approved' then
    raise exception 'VALIDATION_ERROR: only an approved proof can be reversed' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = v_completion.task_id;
  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  select credits into v_balance from public.profiles where id = v_completion.user_id for update;
  v_taken := least(v_completion.reward_amount, greatest(v_balance, 0));

  update public.task_completions
  set status = 'reversed'::completion_status, reviewed_at = now(), reviewed_by = v_admin_id
  where id = p_completion_id;

  if v_taken > 0 then
    perform public.write_ledger_entry(v_completion.user_id, -v_taken, 'reversal',
      'Reward reversed', v_task.id, v_campaign.id, v_admin_id);
    perform public.write_ledger_entry(v_campaign.creator_id, v_taken, 'campaign_refund',
      'Refund for an undone task', v_task.id, v_campaign.id, v_admin_id);
  end if;

  update public.profiles
  set xp = greatest(xp - 10, 0), level = public.calculate_level(greatest(xp - 10, 0))
  where id = v_completion.user_id;

  insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
  values (v_completion.user_id, 'reward_reversed', 'Reward reversed',
    'The action you were paid for was undone, so the reward was taken back.',
    v_task.id, v_campaign.id, 'completion:' || p_completion_id || ':reversed')
  on conflict do nothing;

  insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
  values (v_campaign.creator_id, 'refund', 'Reward returned',
    case when v_taken > 0
         then 'An admin confirmed the action was undone. ' || v_taken || ' credits were returned to you.'
         else 'An admin confirmed the action was undone, but the member had no credits left to return.' end,
    v_task.id, v_campaign.id, 'completion:' || p_completion_id || ':returned')
  on conflict do nothing;

  update public.reports
  set status = 'resolved', resolved_by = v_admin_id, resolved_at = now()
  where related_completion_id = p_completion_id and report_type = 'unfollowed' and status = 'open';

  perform public.log_audit_event(v_admin_id, 'verification.reversed', 'task_completion', p_completion_id,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'reversed', 'taken_back', v_taken, 'reward', v_completion.reward_amount), p_note);

  return v_taken;
end;
$$;

-- Admins close reports as before; for appeals and undone-action reports a
-- dismissal also tells the member (appeal) or the creator (report).
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

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'NOT_FOUND: report not found' using errcode = 'P0001';
  end if;

  update public.reports
  set status = p_decision::report_status, resolved_by = v_admin_id, resolved_at = now()
  where id = p_report_id;

  if v_report.status <> 'open' then
    null; -- re-filing a closed report changes its status only; nobody is told twice
  elsif p_decision = 'dismissed' and v_report.report_type::text = 'proof_appeal' then
    insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
    values (v_report.reporter_id, 'verification_rejected', 'Appeal declined',
      coalesce(nullif(trim(p_note), ''), 'An admin checked your proof and kept the rejection.'),
      v_report.related_task_id, v_report.related_campaign_id, 'report:' || p_report_id || ':dismissed')
    on conflict do nothing;
  elsif p_decision = 'dismissed' and v_report.report_type::text = 'unfollowed' then
    insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
    values (v_report.reporter_id, 'admin_message', 'Report declined',
      coalesce(nullif(trim(p_note), ''), 'An admin checked your report and kept the reward with the member.'),
      v_report.related_task_id, v_report.related_campaign_id, 'report:' || p_report_id || ':dismissed')
    on conflict do nothing;
  end if;

  perform public.log_audit_event(v_admin_id, 'report.' || p_decision, 'report', p_report_id,
    to_jsonb(v_report.status), jsonb_build_object('decision', p_decision), p_note);
end;
$$;

-- ═════════════════════════════════════════════════════ claim a referral

-- As in 015, plus: only before one's first approved task. Otherwise an
-- established member could claim a friend's code and the two would share
-- a bonus on the next approval.
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

  -- Locked, so two claims at once can't both pass the checks.
  perform 1 from public.profiles where id = v_user_id for update;

  if exists (select 1 from public.profiles where id = v_user_id and referred_by is not null) then
    raise exception 'VALIDATION_ERROR: this account has already claimed a referral code'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.task_completions where user_id = v_user_id and status = 'approved') then
    raise exception 'VALIDATION_ERROR: a referral code can only be used before your first approved task'
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

-- ═════════════════════════════════════════ deleting a waiting proof

-- A waiting proof can disappear without a review when its member's account
-- is deleted (on delete cascade). Its place is freed - and on a cancelled
-- campaign the reward kept for it goes back to the creator - so held
-- places always match the proofs actually waiting. The proof row itself
-- is left alone: it is being deleted.
create or replace function public.free_slot_of_deleted_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.campaigns;
  v_refund integer;
begin
  if old.status <> 'pending' or not old.holds_slot then
    return old;
  end if;

  select c.* into v_campaign
  from public.campaigns c
  join public.tasks t on t.campaign_id = c.id
  where t.id = old.task_id
  for update of c;

  if not found then
    return old; -- the campaign is being deleted too
  end if;

  if v_campaign.status in ('active', 'paused') then
    update public.campaigns set reserved_count = greatest(reserved_count - 1, 0) where id = v_campaign.id;
  else
    v_refund := least(old.reward_amount, v_campaign.remaining_budget);
    update public.campaigns
    set reserved_count = greatest(reserved_count - 1, 0), remaining_budget = remaining_budget - v_refund
    where id = v_campaign.id;
    if v_refund > 0 and exists (select 1 from public.profiles where id = v_campaign.creator_id) then
      perform public.write_ledger_entry(v_campaign.creator_id, v_refund, 'campaign_refund',
        'Refund for cancelled campaign', null, v_campaign.id, null);
    end if;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_free_slot_of_deleted_completion on public.task_completions;
create trigger trg_free_slot_of_deleted_completion
  before delete on public.task_completions
  for each row execute function public.free_slot_of_deleted_completion();

-- ═══════════════════════════════════════════════════════════ views

-- Free places, counting proofs that are waiting for review.
create or replace view public.open_tasks
with (security_invoker = true)
as
select
  t.id,
  t.campaign_id,
  t.platform,
  t.task_type,
  t.target_url,
  t.instructions,
  t.verification_method,
  t.created_at,
  c.creator_id,
  c.title as campaign_title,
  c.description as campaign_description,
  c.reward,
  c.desired_completions,
  c.completed_count,
  c.remaining_budget,
  c.reserved_count,
  least(c.desired_completions - c.completed_count - c.reserved_count,
        c.remaining_budget / c.reward - c.reserved_count) as places_left
from public.tasks t
join public.campaigns c on c.id = t.campaign_id
where c.status = 'active'
  and c.completed_count + c.reserved_count < c.desired_completions
  and c.remaining_budget >= c.reward * (c.reserved_count + 1);

grant select on public.open_tasks to authenticated;

-- As in 020, with fields appended: who sent the proof (and from which
-- account), when it is approved automatically or expires, and where an
-- appeal or undone-action report stands. Report fields go through the
-- reports RLS: the member sees their appeal, the creator their report.
create or replace view public.completion_details
with (security_invoker = true)
as
select
  tc.id,
  tc.task_id,
  tc.user_id as completer_id,
  tc.status,
  tc.reward_amount,
  tc.created_at,
  tc.reviewed_at,
  tc.reviewed_by,
  t.campaign_id,
  t.platform,
  t.task_type,
  t.target_url,
  c.creator_id as campaign_creator_id,
  c.title as campaign_title,
  tv.proof_url,
  tv.proof_text,
  tv.submitted_at,
  tv.review_notes,
  tc.auto_approved,
  tv.proof_image_path,
  tv.link_clicked_at,
  t.verification_method,
  p.username as completer_username,
  p.display_name as completer_display_name,
  p.level as completer_level,
  tv.account_username,
  tv.account_url,
  case when tc.status::text = 'pending' and public.doer_is_trusted(tc.user_id)
       then tc.created_at + interval '24 hours' end as auto_approve_at,
  case when tc.status::text = 'pending' and not public.doer_is_trusted(tc.user_id)
       then tc.created_at + interval '72 hours' end as expires_at,
  (select r.status::text from public.reports r
   where r.related_completion_id = tc.id and r.report_type::text = 'proof_appeal'
   order by r.created_at desc limit 1) as appeal_status,
  (select r.status::text from public.reports r
   where r.related_completion_id = tc.id and r.report_type::text = 'unfollowed'
   order by r.created_at desc limit 1) as undo_report_status
from public.task_completions tc
join public.tasks t on t.id = tc.task_id
join public.campaigns c on c.id = t.campaign_id
join public.task_verifications tv on tv.completion_id = tc.id
join public.profiles p on p.id = tc.user_id;

grant select on public.completion_details to authenticated;

-- ═══════════════════════════════════════════════════════════ grants

revoke execute on function
  public.log_audit_event(uuid, text, text, uuid, jsonb, jsonb, text),
  public.pay_approved_completion(uuid, uuid),
  public.claim_referral(text),
  public.free_slot_of_deleted_completion(),
  public.pending_proof_limit(integer),
  public.doer_is_trusted(uuid),
  public.release_completion_slot(uuid),
  public.starter_bonus_creators(uuid),
  public.try_starter_bonus(uuid),
  public.get_starter_bonus(),
  public.try_reward_referral(uuid),
  public.reward_task_completion(uuid, uuid),
  public.review_task_verification(uuid, text, text),
  public.cancel_campaign(uuid, text),
  public.submit_task_verification(uuid, text, text, text, uuid),
  public.check_link_click_task(uuid, uuid),
  public.auto_approve_overdue_completions(integer),
  public.doer_review_stats(uuid[]),
  public.get_my_proof_limits(),
  public.appeal_rejection(uuid, text),
  public.admin_overturn_rejection(uuid, text),
  public.report_unfollow(uuid, text),
  public.admin_reverse_reward(uuid, text),
  public.admin_resolve_report(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.claim_referral(text) to authenticated;
grant execute on function public.pending_proof_limit(integer) to authenticated;
-- doer_is_trusted runs inside completion_details for whoever reads it.
grant execute on function public.doer_is_trusted(uuid) to authenticated;
grant execute on function public.get_starter_bonus() to authenticated;
grant execute on function public.review_task_verification(uuid, text, text) to authenticated;
grant execute on function public.cancel_campaign(uuid, text) to authenticated;
grant execute on function public.submit_task_verification(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.doer_review_stats(uuid[]) to authenticated;
grant execute on function public.get_my_proof_limits() to authenticated;
grant execute on function public.appeal_rejection(uuid, text) to authenticated;
grant execute on function public.admin_overturn_rejection(uuid, text) to authenticated;
grant execute on function public.report_unfollow(uuid, text) to authenticated;
grant execute on function public.admin_reverse_reward(uuid, text) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
