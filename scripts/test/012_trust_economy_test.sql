-- 012_trust_economy_test.sql
-- 021_trust_and_economy.sql: held places, cancellation, creator notice,
-- the account used, waiting-proof limit, doer trust and expiry, appeals,
-- undone actions, reused screenshots, referral and welcome bonuses, grants
-- - and, at the end, that every balance still matches the ledger.
-- Same conventions as 001: app.current_user_id stands in for auth.uid(),
-- every check RAISEs NOTICE 'PASS' or an EXCEPTION.

\set ON_ERROR_STOP on

create temporary table t21 (key text primary key, value text);
create or replace function t21_get(p_key text) returns text language sql as
  $$ select value from t21 where key = p_key $$;
create or replace function t21_set(p_key text, p_value text) returns void language sql as
  $$ insert into t21 (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value $$;
-- people: 0 admin, 1 cora, 2 dex, 3 ivy, 4 rex, 5 ned, 6 ola, 7 pia,
-- 8 uma, 9 sam, 10 lev, 11-15 rex's earlier referrals, 16 zoe
create or replace function u21(n integer) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-0000-' || lpad((1000 + n)::text, 12, '0'))::uuid $$;
create or replace function t21_as(n integer) returns text language sql as
  $$ select set_config('app.current_user_id', u21(n)::text, false) $$;
create or replace function t21_acct(n integer, p text) returns uuid language sql as
  $$ select id from public.social_profiles where user_id = u21(n) and platform::text = p $$;
create or replace function t21_task(p_campaign text) returns uuid language sql as
  $$ select id from public.tasks where campaign_id = t21_get(p_campaign)::uuid $$;
create or replace function t21_credits(n integer) returns integer language sql as
  $$ select credits from public.profiles where id = u21(n) $$;
create or replace function t21_campaign(p_key text) returns public.campaigns language sql as
  $$ select * from public.campaigns where id = t21_get(p_key)::uuid $$;

-- ---------------------------------------------------------------- setup
insert into auth.users (id, email) select u21(n), 'u' || n || '@t21.example' from generate_series(0, 16) n;
update public.profiles set role = 'admin' where id = u21(0);

insert into public.social_profiles (user_id, platform, username, profile_url) values
  (u21(2), 'instagram', 'dex', 'https://instagram.com/dex'),
  (u21(3), 'instagram', 'ivy', 'https://instagram.com/ivy'),
  (u21(8), 'instagram', 'uma', 'https://instagram.com/uma');

select t21_as(0);
select public.admin_credit_adjustment(u21(1), 5000, 'seed for 021 tests');
select public.admin_credit_adjustment(u21(4), 500, 'seed for 021 tests');
select public.admin_credit_adjustment(u21(6), 500, 'seed for 021 tests');
select public.admin_credit_adjustment(u21(7), 500, 'seed for 021 tests');
select public.admin_credit_adjustment(u21(9), 500, 'seed for 021 tests');

-- ==================================================== 2. places are held
select t21_as(1); -- cora
select t21_set('c1', public.create_campaign('Follow cora', '', 'instagram', 'follow',
  'https://instagram.com/cora', '', 'manual_proof', 10, 2)::text);

do $$
begin
  if (select places_left from public.open_tasks where campaign_id = t21_get('c1')::uuid) <> 2 then
    raise exception 'FAIL: a new 2-place campaign should show 2 places left';
  end if;
  raise notice 'PASS: open_tasks shows the places left';
end $$;

select t21_as(2); -- dex
select t21_set('dex_c1', public.submit_task_verification(t21_task('c1'), 'https://instagram.com/p/dex', null, null,
  t21_acct(2, 'instagram'))::text);

do $$
begin
  if (t21_campaign('c1')).reserved_count <> 1 or (t21_campaign('c1')).completed_count <> 0 then
    raise exception 'FAIL: sending proof did not hold a place';
  end if;
  if not (select holds_slot from public.task_completions where id = t21_get('dex_c1')::uuid) then
    raise exception 'FAIL: the proof is not marked as holding a place';
  end if;
  if (select places_left from public.open_tasks where campaign_id = t21_get('c1')::uuid) <> 1 then
    raise exception 'FAIL: places left did not go down';
  end if;
  raise notice 'PASS: sending proof holds one place until it is reviewed';
end $$;

select t21_as(3); -- ivy
select t21_set('ivy_c1', public.submit_task_verification(t21_task('c1'), 'https://instagram.com/p/ivy', null, null,
  t21_acct(3, 'instagram'))::text);

do $$
begin
  if exists (select 1 from public.open_tasks where campaign_id = t21_get('c1')::uuid) then
    raise exception 'FAIL: a campaign with every place held is still listed as open';
  end if;
  raise notice 'PASS: a campaign whose places are all held leaves open_tasks';
end $$;

select t21_as(8); -- uma
do $$
begin
  begin
    perform public.submit_task_verification(t21_task('c1'), 'https://instagram.com/p/uma', null, null, t21_acct(8, 'instagram'));
    raise exception 'FAIL: a third proof was accepted for two places';
  exception when others then
    if sqlerrm not like 'TASK_NOT_AVAILABLE%' then raise; end if;
    raise notice 'PASS: a campaign never takes more proofs than it has places';
  end;
end $$;

-- ================================================ 3. the creator is told
do $$
begin
  if (select count(*) from public.notifications
      where user_id = u21(1) and type::text = 'proof_submitted' and related_campaign_id = t21_get('c1')::uuid) <> 1 then
    raise exception 'FAIL: expected exactly one unread "new proof" notice for two proofs';
  end if;
  raise notice 'PASS: the creator gets one "new proof" notice, not one per proof';
end $$;

update public.notifications set read_at = now() where user_id = u21(1) and type::text = 'proof_submitted';

-- ================================================== 4. the account used
select t21_as(1);
select t21_set('c2', public.create_campaign('Like cora', '', 'tiktok', 'like',
  'https://tiktok.com/@cora/video/2', '', 'manual_proof', 10, 3)::text);
select t21_set('c3', public.create_campaign('Read cora''s post', '', 'other', 'visit',
  'https://example.com/cora', '', 'manual_proof', 5, 3)::text);

select t21_as(3); -- ivy: no TikTok account linked yet
do $$
begin
  begin
    perform public.submit_task_verification(t21_task('c2'), 'https://tiktok.com/proof', null, null, null);
    raise exception 'FAIL: a like was accepted without the account it was done from';
  exception when others then
    if sqlerrm not like 'ACCOUNT_REQUIRED: choose the account%' then raise; end if;
    raise notice 'PASS: a like task needs the account it was done from';
  end;
  begin
    perform public.submit_task_verification(t21_task('c2'), 'https://tiktok.com/proof', null, null, t21_acct(2, 'instagram'));
    raise exception 'FAIL: someone else''s account was accepted';
  exception when others then
    if sqlerrm not like 'ACCOUNT_REQUIRED: that account is not linked%' then raise; end if;
    raise notice 'PASS: another member''s account is refused';
  end;
  begin
    perform public.submit_task_verification(t21_task('c2'), 'https://tiktok.com/proof', null, null, t21_acct(3, 'instagram'));
    raise exception 'FAIL: an Instagram account was accepted for a TikTok task';
  exception when others then
    if sqlerrm not like 'ACCOUNT_REQUIRED%' then raise; end if;
    raise notice 'PASS: an account on another platform is refused';
  end;
end $$;

insert into public.social_profiles (user_id, platform, username, profile_url)
values (u21(3), 'tiktok', 'ivy.tt', 'https://tiktok.com/@ivy.tt');
select t21_set('ivy_c2', public.submit_task_verification(t21_task('c2'), 'https://tiktok.com/proof', null, null,
  t21_acct(3, 'tiktok'))::text);
update public.social_profiles set username = 'ivy.renamed' where user_id = u21(3) and platform = 'tiktok';
select t21_set('ivy_c3', public.submit_task_verification(t21_task('c3'), 'https://example.com/seen', null, null, null)::text);

do $$
begin
  if not exists (select 1 from public.completion_details
                 where id = t21_get('ivy_c2')::uuid and account_username = 'ivy.tt'
                   and account_url = 'https://tiktok.com/@ivy.tt'
                   and completer_username is not null and completer_level = 1) then
    raise exception 'FAIL: the account handle (as it was when sent) is not shown with the proof';
  end if;
  if not exists (select 1 from public.completion_details where id = t21_get('ivy_c3')::uuid and account_username is null) then
    raise exception 'FAIL: a visit task should not need an account';
  end if;
  raise notice 'PASS: the account handle is kept with the proof; visits need none';
end $$;

-- ========================================= 2. a rejection frees the place
select t21_as(1);
select public.review_task_verification(t21_get('ivy_c1')::uuid, 'rejected', 'No follow on my page');

do $$
begin
  if (t21_campaign('c1')).reserved_count <> 1
     or (select holds_slot from public.task_completions where id = t21_get('ivy_c1')::uuid) then
    raise exception 'FAIL: a rejection did not free the place';
  end if;
  if (select places_left from public.open_tasks where campaign_id = t21_get('c1')::uuid) <> 1 then
    raise exception 'FAIL: the freed place is not open again';
  end if;
  raise notice 'PASS: a rejection frees the place for someone else';
end $$;

select t21_as(8); -- uma takes the freed place
select t21_set('uma_c1', public.submit_task_verification(t21_task('c1'), 'https://instagram.com/p/uma', null, null,
  t21_acct(8, 'instagram'))::text);

do $$
begin
  if (select count(*) from public.notifications
      where user_id = u21(1) and type::text = 'proof_submitted' and related_campaign_id = t21_get('c1')::uuid) <> 2 then
    raise exception 'FAIL: once the first notice was read, a new proof should notify again';
  end if;
  raise notice 'PASS: after the creator reads the notice, the next proof notifies again';
end $$;

-- ============================ 2. cancelling keeps money for waiting proofs
select t21_as(1);
select t21_set('c4', public.create_campaign('Follow cora 4', '', 'instagram', 'follow',
  'https://instagram.com/cora4', '', 'manual_proof', 10, 3)::text);
select t21_as(2);
select t21_set('dex_c4', public.submit_task_verification(t21_task('c4'), 'https://instagram.com/p/dex4', null, null,
  t21_acct(2, 'instagram'))::text);
select t21_as(3);
select t21_set('ivy_c4', public.submit_task_verification(t21_task('c4'), 'https://instagram.com/p/ivy4', null, null,
  t21_acct(3, 'instagram'))::text);

select t21_as(1);
select t21_set('cora_before', t21_credits(1)::text);
select public.cancel_campaign(t21_get('c4')::uuid, 'changed plans');

do $$
begin
  if (t21_campaign('c4')).status <> 'cancelled' or (t21_campaign('c4')).remaining_budget <> 20 then
    raise exception 'FAIL: cancelling should keep 20 (two waiting proofs), kept %', (t21_campaign('c4')).remaining_budget;
  end if;
  if t21_credits(1) <> t21_get('cora_before')::int + 10 then
    raise exception 'FAIL: cancelling should refund only the free place (10)';
  end if;
  raise notice 'PASS: cancelling refunds the free places and keeps the reward of proofs already sent';
end $$;

select t21_set('dex_before', t21_credits(2)::text);
select public.review_task_verification(t21_get('dex_c4')::uuid, 'approved', null);
select t21_set('cora_before', t21_credits(1)::text);
select public.review_task_verification(t21_get('ivy_c4')::uuid, 'rejected', 'Not following');

do $$
begin
  if t21_credits(2) <> t21_get('dex_before')::int + 10 then
    raise exception 'FAIL: a proof sent before the cancellation was not paid when approved';
  end if;
  if t21_credits(1) <> t21_get('cora_before')::int + 10 then
    raise exception 'FAIL: rejecting a waiting proof on a cancelled campaign did not return its reward to the creator';
  end if;
  if (t21_campaign('c4')).remaining_budget <> 0 or (t21_campaign('c4')).reserved_count <> 0
     or (t21_campaign('c4')).status <> 'cancelled' then
    raise exception 'FAIL: the cancelled campaign should end with nothing left or held';
  end if;
  raise notice 'PASS: after a cancellation, approved proofs are paid and rejected ones refund the creator';
end $$;

select t21_set('c5', public.create_campaign('Follow cora 5', '', 'instagram', 'follow',
  'https://instagram.com/cora5', '', 'manual_proof', 10, 2)::text);
select t21_as(2);
select t21_set('dex_c5', public.submit_task_verification(t21_task('c5'), 'https://instagram.com/p/dex5', null, null,
  t21_acct(2, 'instagram'))::text);
select t21_as(1);
select public.cancel_campaign(t21_get('c5')::uuid, 'changed plans again');
update public.task_completions set created_at = now() - interval '25 hours' where id = t21_get('dex_c5')::uuid;
select t21_set('dex_before', t21_credits(2)::text);
select public.auto_approve_overdue_completions();

do $$
begin
  if not exists (select 1 from public.task_completions where id = t21_get('dex_c5')::uuid and status = 'approved' and auto_approved)
     or t21_credits(2) <> t21_get('dex_before')::int + 10 then
    raise exception 'FAIL: a proof sent before the cancellation was not approved automatically after 24 h';
  end if;
  raise notice 'PASS: a proof sent before a cancellation is still approved automatically and paid';
end $$;

-- ============================================ 5/10. the waiting-proof limit
do $$
begin
  if public.pending_proof_limit(1) <> 10 or public.pending_proof_limit(2) <> 15
     or public.pending_proof_limit(5) <> 30 or public.pending_proof_limit(12) <> 30 then
    raise exception 'FAIL: pending_proof_limit should be 5 + 5 x level, at most 30';
  end if;
  raise notice 'PASS: the waiting-proof limit is 5 + 5 x level, 30 at most';
end $$;

select t21_as(1);
do $$
begin
  for i in 1..11 loop
    perform t21_set('lim' || i, public.create_campaign('Small task ' || i, '', 'other', 'custom',
      'https://example.com/small/' || i, '', 'manual_proof', 1, 1)::text);
  end loop;
end $$;

select t21_as(10); -- lev, level 1
do $$
begin
  for i in 1..10 loop
    perform public.submit_task_verification(t21_task('lim' || i), null, 'done ' || i, null, null);
  end loop;
  begin
    perform public.submit_task_verification(t21_task('lim11'), null, 'done 11', null, null);
    raise exception 'FAIL: an 11th waiting proof was accepted at level 1';
  exception when others then
    if sqlerrm not like 'PENDING_LIMIT%' then raise; end if;
    raise notice 'PASS: at level 1 a member can have 10 proofs waiting, not 11';
  end;
end $$;

update public.profiles set level = 2 where id = u21(10);
select public.submit_task_verification(t21_task('lim11'), null, 'done 11', null, null);

do $$
declare
  r record;
begin
  select * into r from public.get_my_proof_limits();
  if r.pending_count <> 11 or r.pending_limit <> 15 or r.level <> 2 or not r.trusted then
    raise exception 'FAIL: get_my_proof_limits gave % / % (level %, trusted %)', r.pending_count, r.pending_limit, r.level, r.trusted;
  end if;
  raise notice 'PASS: a higher level raises the limit (level 2: 15), and get_my_proof_limits reports it';
end $$;

-- ======================================== 5. doers often rejected wait
select t21_as(1);
do $$
begin
  for i in 1..6 loop
    perform t21_set('u' || i, public.create_campaign('Uma check ' || i, '', 'other', 'custom',
      'https://example.com/uma/' || i, '', 'manual_proof', 1, 1)::text);
  end loop;
end $$;

select t21_as(8); -- uma
do $$
begin
  for i in 1..6 loop
    perform t21_set('uma_u' || i, public.submit_task_verification(t21_task('u' || i), null, 'trust me', null, null)::text);
  end loop;
end $$;

select t21_as(1);
do $$
begin
  for i in 1..5 loop
    perform public.review_task_verification(t21_get('uma_u' || i)::uuid, 'rejected', 'Not done');
  end loop;
  perform public.review_task_verification(t21_get('uma_u6')::uuid, 'approved', null);
end $$;

do $$
declare
  r record;
begin
  select * into r from public.doer_review_stats(array[u21(8), u21(2)]) where user_id = u21(8);
  if r.approved <> 1 or r.rejected <> 5 or r.reversed <> 0 or r.trusted then
    raise exception 'FAIL: doer_review_stats for uma: % approved, % rejected, trusted %', r.approved, r.rejected, r.trusted;
  end if;
  if not (select trusted from public.doer_review_stats(array[u21(2)])) then
    raise exception 'FAIL: dex (never rejected) should be trusted';
  end if;
  if not exists (select 1 from public.completion_details
                 where id = t21_get('uma_c1')::uuid and auto_approve_at is null
                   and expires_at = created_at + interval '72 hours') then
    raise exception 'FAIL: completion_details should show an expiry, not auto-approval, for uma';
  end if;
  if not exists (select 1 from public.completion_details
                 where id = t21_get('dex_c1')::uuid and expires_at is null
                   and auto_approve_at = created_at + interval '24 hours') then
    raise exception 'FAIL: completion_details should show auto-approval in 24 h for dex';
  end if;
  raise notice 'PASS: doer_review_stats and completion_details tell reviewers who is trusted';
end $$;

update public.task_completions set created_at = now() - interval '25 hours' where id = t21_get('uma_c1')::uuid;
select public.auto_approve_overdue_completions();

do $$
begin
  if not exists (select 1 from public.task_completions where id = t21_get('uma_c1')::uuid and status = 'pending') then
    raise exception 'FAIL: a member with many rejections was approved automatically';
  end if;
  raise notice 'PASS: proofs from members with many rejections are not approved automatically';
end $$;

update public.task_completions set created_at = now() - interval '73 hours' where id = t21_get('uma_c1')::uuid;
select public.auto_approve_overdue_completions();

do $$
begin
  if not exists (select 1 from public.task_completions where id = t21_get('uma_c1')::uuid and status = 'expired' and not holds_slot) then
    raise exception 'FAIL: the untrusted proof did not expire after 72 h';
  end if;
  if (t21_campaign('c1')).reserved_count <> 1 then
    raise exception 'FAIL: the expired proof did not free its place';
  end if;
  if not exists (select 1 from public.notifications where user_id = u21(8) and title = 'Submission expired'
                 and body like 'Not reviewed within 3 days.%') then
    raise exception 'FAIL: uma was not told why her proof expired';
  end if;
  raise notice 'PASS: after 72 h without review their proof expires, frees its place and says why';
end $$;

-- ============================================================ 6. appeals
select t21_as(2); -- dex can't appeal ivy's proof
do $$
begin
  begin
    perform public.appeal_rejection(t21_get('ivy_c1')::uuid, 'This is not my proof but anyway');
    raise exception 'FAIL: a member appealed someone else''s proof';
  exception when others then
    if sqlerrm not like 'NOT_FOUND%' then raise; end if;
    raise notice 'PASS: only the member who sent the proof can appeal';
  end;
end $$;

select t21_as(3); -- ivy
do $$
begin
  begin
    perform public.appeal_rejection(t21_get('ivy_c1')::uuid, 'unfair');
    raise exception 'FAIL: an appeal without an explanation was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: explain%' then raise; end if;
    raise notice 'PASS: an appeal needs an explanation';
  end;
  begin
    perform public.appeal_rejection(t21_get('ivy_c2')::uuid, 'This one is still waiting');
    raise exception 'FAIL: a waiting proof was appealed';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: only a rejected proof%' then raise; end if;
    raise notice 'PASS: only rejected proofs can be appealed';
  end;
end $$;

select t21_set('appeal1', public.appeal_rejection(t21_get('ivy_c1')::uuid,
  'I followed from @ivy, the screenshot shows it')::text);

do $$
begin
  if not exists (select 1 from public.reports where id = t21_get('appeal1')::uuid
                 and report_type::text = 'proof_appeal' and status = 'open'
                 and related_completion_id = t21_get('ivy_c1')::uuid and related_user_id = u21(1)) then
    raise exception 'FAIL: the appeal was not filed as an open report about the proof';
  end if;
  begin
    perform public.appeal_rejection(t21_get('ivy_c1')::uuid, 'Second appeal for the same thing');
    raise exception 'FAIL: the same proof was appealed twice';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: this proof was already appealed%' then raise; end if;
    raise notice 'PASS: an appeal is filed for an admin, once per proof';
  end;
end $$;

-- What each side sees of the appeal (through RLS).
select set_config('t21.ivy_c1', t21_get('ivy_c1'), false);
set role authenticated;
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000001003', false); -- ivy
do $$
begin
  if (select appeal_status from public.completion_details where id = current_setting('t21.ivy_c1')::uuid) is distinct from 'open' then
    raise exception 'FAIL: ivy does not see her appeal as open';
  end if;
end $$;
select set_config('app.current_user_id', '00000000-0000-0000-0000-000000001001', false); -- cora
do $$
begin
  if (select appeal_status from public.completion_details where id = current_setting('t21.ivy_c1')::uuid) is not null then
    raise exception 'FAIL: the creator can see the member''s appeal';
  end if;
  raise notice 'PASS: the member sees where her appeal stands; the creator doesn''t see it';
end $$;
reset role;

select t21_as(1); -- not an admin
do $$
begin
  begin
    perform public.admin_overturn_rejection(t21_get('ivy_c1')::uuid, 'I am not an admin');
    raise exception 'FAIL: a member overturned a rejection';
  exception when others then
    if sqlerrm not like 'FORBIDDEN%' then raise; end if;
    raise notice 'PASS: only admins decide appeals';
  end;
end $$;

select t21_as(0);
select t21_set('ivy_before', t21_credits(3)::text);
select public.admin_overturn_rejection(t21_get('ivy_c1')::uuid, 'Screenshot shows the follow');

do $$
begin
  if not exists (select 1 from public.task_completions where id = t21_get('ivy_c1')::uuid
                 and status = 'approved' and reviewed_by = u21(0)) then
    raise exception 'FAIL: the overturned proof is not approved';
  end if;
  if t21_credits(3) <> t21_get('ivy_before')::int + 10 then
    raise exception 'FAIL: the overturned proof was not paid';
  end if;
  if (select status from public.reports where id = t21_get('appeal1')::uuid) <> 'resolved' then
    raise exception 'FAIL: the appeal was not closed';
  end if;
  if (t21_campaign('c1')).completed_count <> 1 or (t21_campaign('c1')).reserved_count <> 1 then
    raise exception 'FAIL: the overturn should take the free place (1 done, 1 held)';
  end if;
  raise notice 'PASS: an admin can approve a rejected proof on appeal - paid from a free place';
end $$;

-- ivy's rejected proof on the cancelled campaign c4: its reward went back
-- to cora when she rejected it, so cora - who rejected it wrongly - pays.
select t21_as(3);
select t21_set('appeal2', public.appeal_rejection(t21_get('ivy_c4')::uuid, 'I really did follow cora4')::text);
select t21_as(0);
select t21_set('ivy_before', t21_credits(3)::text);
select t21_set('cora_before', t21_credits(1)::text);
select public.admin_overturn_rejection(t21_get('ivy_c4')::uuid, 'The follow is in the screenshot');

do $$
begin
  if not exists (select 1 from public.task_completions where id = t21_get('ivy_c4')::uuid and status = 'approved') then
    raise exception 'FAIL: the overturn on a cancelled campaign did not approve the proof';
  end if;
  if t21_credits(3) <> t21_get('ivy_before')::int + 10 or t21_credits(1) <> t21_get('cora_before')::int - 10 then
    raise exception 'FAIL: with no place left the creator should pay the 10 credits';
  end if;
  if not exists (select 1 from public.credit_ledger where user_id = u21(1) and type = 'penalty'
                 and description = 'Rejected proof approved on appeal' and amount = -10) then
    raise exception 'FAIL: the creator''s payment is not in the ledger as a penalty';
  end if;
  if (t21_campaign('c4')).completed_count <> 1 or (t21_campaign('c4')).remaining_budget <> 0 then
    raise exception 'FAIL: the cancelled campaign''s counters should not change';
  end if;
  raise notice 'PASS: with no place left (cancelled campaign), the creator who rejected it pays on appeal';
end $$;

-- a member whose creator can't pay: the overturn stops, nothing changes
select t21_as(0);
select public.admin_credit_adjustment(u21(9), 100, 'seed: sam funds a tiny campaign');
select t21_as(9);
select t21_set('c7', public.create_campaign('Sam follow', '', 'instagram', 'follow',
  'https://instagram.com/sam', '', 'manual_proof', 10, 1)::text);
select t21_as(3);
select t21_set('ivy_c7', public.submit_task_verification(t21_task('c7'), 'https://instagram.com/p/ivy7', null, null,
  t21_acct(3, 'instagram'))::text);
select t21_as(9);
select public.review_task_verification(t21_get('ivy_c7')::uuid, 'rejected', 'No');
select public.cancel_campaign(t21_get('c7')::uuid, 'done');
select t21_as(0);
do $$
declare
  v_credits integer := t21_credits(9);
begin
  if v_credits > 0 then
    perform public.admin_credit_adjustment(u21(9), -v_credits, 'test: sam spent everything');
  end if;
  begin
    perform public.admin_overturn_rejection(t21_get('ivy_c7')::uuid, 'should be paid');
    raise exception 'FAIL: an overturn was paid by a creator with no credits';
  exception when others then
    if sqlerrm not like 'INSUFFICIENT_CREDITS%' then raise; end if;
  end;
  if not exists (select 1 from public.task_completions where id = t21_get('ivy_c7')::uuid and status = 'rejected') then
    raise exception 'FAIL: a failed overturn changed the proof';
  end if;
  raise notice 'PASS: if nobody can pay, the overturn stops and the proof stays as it was';
end $$;
select public.admin_credit_adjustment(u21(9), 500, 'test: refill sam');

-- a second appeal to dismiss
select t21_as(3);
select t21_set('appeal3', public.appeal_rejection(t21_get('ivy_c7')::uuid, 'sam''s page shows my follow')::text);
select t21_as(0);
select public.admin_resolve_report(t21_get('appeal3')::uuid, 'dismissed', '');
select public.admin_resolve_report(t21_get('appeal3')::uuid, 'dismissed', 'again');
do $$
begin
  if (select count(*) from public.notifications where user_id = u21(3) and title = 'Appeal declined'
      and body = 'An admin checked your proof and kept the rejection.') <> 1 then
    raise exception 'FAIL: ivy should be told exactly once that her appeal was declined';
  end if;
  raise notice 'PASS: a declined appeal is announced to the member, once';
end $$;

update public.task_completions set reviewed_at = now() - interval '8 days' where id = t21_get('uma_u1')::uuid;
select t21_as(8);
do $$
begin
  begin
    perform public.appeal_rejection(t21_get('uma_u1')::uuid, 'Rejected long ago but still unfair');
    raise exception 'FAIL: an appeal 8 days after the rejection was accepted';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: appeals are possible within 7 days%' then raise; end if;
    raise notice 'PASS: appeals are possible within 7 days of the rejection';
  end;
end $$;

-- ===================================================== 7. undone actions
select t21_as(3); -- ivy is not the creator
do $$
begin
  begin
    perform public.report_unfollow(t21_get('dex_c4')::uuid, 'He unfollowed cora yesterday');
    raise exception 'FAIL: someone other than the creator reported an undone action';
  exception when others then
    if sqlerrm not like 'NOT_FOUND%' then raise; end if;
    raise notice 'PASS: only the creator can report an undone action';
  end;
end $$;

select t21_as(1); -- cora
select public.review_task_verification(t21_get('ivy_c3')::uuid, 'approved', null);
do $$
begin
  begin
    perform public.report_unfollow(t21_get('ivy_c3')::uuid, 'She did not really visit it');
    raise exception 'FAIL: a visit was reported as undone';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: a visit cannot be undone%' then raise; end if;
    raise notice 'PASS: visits can''t be reported as undone';
  end;
end $$;

update public.task_completions set reviewed_at = now() - interval '8 days' where id = t21_get('dex_c5')::uuid;
do $$
begin
  begin
    perform public.report_unfollow(t21_get('dex_c5')::uuid, 'He unfollowed after a week');
    raise exception 'FAIL: an approval older than 7 days was reported';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: reports are possible within 7 days%' then raise; end if;
    raise notice 'PASS: undone actions can be reported within 7 days of the approval';
  end;
end $$;

select t21_set('undo1', public.report_unfollow(t21_get('dex_c4')::uuid, 'dex unfollowed cora4 the next day')::text);
do $$
begin
  if not exists (select 1 from public.reports where id = t21_get('undo1')::uuid and report_type::text = 'unfollowed'
                 and related_user_id = u21(2) and related_completion_id = t21_get('dex_c4')::uuid) then
    raise exception 'FAIL: the undone-action report was not filed';
  end if;
  begin
    perform public.report_unfollow(t21_get('dex_c4')::uuid, 'Reporting the same thing again');
    raise exception 'FAIL: the same approval was reported twice';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: this proof was already reported%' then raise; end if;
    raise notice 'PASS: the creator can report an undone action once per proof';
  end;
end $$;

select t21_as(0);
select t21_set('dex_before', t21_credits(2)::text);
select t21_set('cora_before', t21_credits(1)::text);
select t21_set('dex_xp', (select xp from public.profiles where id = u21(2))::text);
select t21_set('taken', public.admin_reverse_reward(t21_get('dex_c4')::uuid, 'Confirmed: unfollowed')::text);

do $$
begin
  if t21_get('taken')::int <> 10 or t21_credits(2) <> t21_get('dex_before')::int - 10
     or t21_credits(1) <> t21_get('cora_before')::int + 10 then
    raise exception 'FAIL: the reward was not moved back from dex to cora';
  end if;
  if not exists (select 1 from public.task_completions where id = t21_get('dex_c4')::uuid and status::text = 'reversed') then
    raise exception 'FAIL: the proof is not marked reversed';
  end if;
  if (select xp from public.profiles where id = u21(2)) <> t21_get('dex_xp')::int - 10 then
    raise exception 'FAIL: the task''s XP was not taken back';
  end if;
  if (select status from public.reports where id = t21_get('undo1')::uuid) <> 'resolved' then
    raise exception 'FAIL: the report was not closed';
  end if;
  if not exists (select 1 from public.notifications where user_id = u21(2) and type::text = 'reward_reversed')
     or not exists (select 1 from public.notifications where user_id = u21(1) and title = 'Reward returned'
                    and body = 'An admin confirmed the action was undone. 10 credits were returned to you.') then
    raise exception 'FAIL: both sides should be told about the reversal';
  end if;
  if (select reversed from public.doer_review_stats(array[u21(2)])) <> 1 then
    raise exception 'FAIL: the reversal does not count in dex''s track record';
  end if;
  begin
    perform public.admin_reverse_reward(t21_get('dex_c4')::uuid, 'again');
    raise exception 'FAIL: a reward was reversed twice';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: only an approved proof can be reversed%' then raise; end if;
  end;
  raise notice 'PASS: an admin can take the reward back to the creator - once, with XP, record and notices';
end $$;

-- A member who already spent the reward: only what is left is taken.
select t21_as(1);
select t21_set('undo2', public.report_unfollow(t21_get('ivy_c1')::uuid, 'ivy unfollowed after the appeal')::text);
select t21_as(0);
do $$
declare
  v_credits integer := t21_credits(3);
begin
  if v_credits <> 4 then
    perform public.admin_credit_adjustment(u21(3), 4 - v_credits, 'test: ivy spent most of her credits');
  end if;
end $$;
select t21_set('cora_before', t21_credits(1)::text);
select t21_set('taken', public.admin_reverse_reward(t21_get('ivy_c1')::uuid, 'Confirmed')::text);

do $$
begin
  if t21_get('taken')::int <> 4 or t21_credits(3) <> 0 or t21_credits(1) <> t21_get('cora_before')::int + 4 then
    raise exception 'FAIL: a partial take-back should move exactly what the member had (4)';
  end if;
  raise notice 'PASS: only the credits the member still has are taken back - never a negative balance';
end $$;

-- ================================================== 8. reused screenshots
insert into public.proof_images (path, user_id, sha256) values
  (u21(2) || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', u21(2), repeat('ab', 32)),
  (u21(3) || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp', u21(3), repeat('ab', 32));

select t21_as(1);
select t21_set('c6', public.create_campaign('Screenshot task', '', 'other', 'custom',
  'https://example.com/shot', '', 'manual_proof', 5, 5)::text);
select t21_as(2);
select t21_set('dex_c6', public.submit_task_verification(t21_task('c6'), null, null,
  u21(2) || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', null)::text);

select t21_as(3);
do $$
begin
  if (select proof_image_sha from public.task_verifications where completion_id = t21_get('dex_c6')::uuid) <> repeat('ab', 32) then
    raise exception 'FAIL: the screenshot''s fingerprint was not stored with the proof';
  end if;
  begin
    perform public.submit_task_verification(t21_task('c6'), null, null,
      u21(3) || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp', null);
    raise exception 'FAIL: the same image was accepted as proof twice';
  exception when others then
    if sqlerrm not like 'DUPLICATE_PROOF%' then raise; end if;
    raise notice 'PASS: an image already used as proof is refused, whoever sends it';
  end;
end $$;

select t21_set('ivy_c6', public.submit_task_verification(t21_task('c6'), null, null,
  u21(3) || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp', null)::text);
do $$
begin
  if (select proof_image_sha from public.task_verifications where completion_id = t21_get('ivy_c6')::uuid) is not null then
    raise exception 'FAIL: an image the API never fingerprinted got a fingerprint';
  end if;
  raise notice 'PASS: an image uploaded before fingerprints existed is still accepted';
end $$;

-- ============================================================ 1. referrals
select t21_as(5); -- ned joins with rex's code
select public.claim_referral((select referral_code from public.profiles where id = u21(4)));
select t21_as(9); -- so does sam
select public.claim_referral((select referral_code from public.profiles where id = u21(4)));

select t21_as(4); -- rex's own campaign
select t21_set('r1', public.create_campaign('Rex task', '', 'other', 'custom', 'https://example.com/rex', '', 'manual_proof', 5, 2)::text);
select t21_as(9); -- a campaign by someone else rex brought in
select t21_set('r2', public.create_campaign('Sam task', '', 'other', 'custom', 'https://example.com/sam', '', 'manual_proof', 5, 2)::text);
select t21_as(6); -- ola: unconnected; a link-click task and a normal one
select t21_set('r3', public.create_campaign('Ola visit', '', 'other', 'visit', 'https://example.com/ola', '', 'link_click', 5, 2)::text);
select t21_set('r4', public.create_campaign('Ola task', '', 'other', 'custom', 'https://example.com/ola2', '', 'manual_proof', 5, 2)::text);
select t21_as(7); -- pia: unconnected
select t21_set('r5', public.create_campaign('Pia task', '', 'other', 'custom', 'https://example.com/pia', '', 'manual_proof', 5, 2)::text);

select t21_as(5);
select t21_set('ned_r1', public.submit_task_verification(t21_task('r1'), null, 'done', null, null)::text);
select t21_set('ned_r2', public.submit_task_verification(t21_task('r2'), null, 'done', null, null)::text);
select public.record_task_link_click(t21_task('r3'));
update public.task_link_clicks set clicked_at = now() - interval '20 seconds' where task_id = t21_task('r3') and user_id = u21(5);
select public.complete_link_click_task(t21_task('r3'));
select t21_as(4);
select public.review_task_verification(t21_get('ned_r1')::uuid, 'approved', null);
select t21_as(9);
select public.review_task_verification(t21_get('ned_r2')::uuid, 'approved', null);

do $$
begin
  if (select status from public.referrals where referred_id = u21(5)) <> 'pending' then
    raise exception 'FAIL: the referral bonus was paid for an approval by the referrer, his circle or a link click';
  end if;
  raise notice 'PASS: no referral bonus for approvals by the referrer, people he brought in, or automatic ones';
end $$;

-- rex already earned 5 referral bonuses today
insert into public.referrals (referrer_id, referred_id, status, reward_issued_at)
select u21(4), u21(n), 'rewarded', now() - interval '1 hour' from generate_series(11, 15) n;

select t21_as(5);
select t21_set('ned_r4', public.submit_task_verification(t21_task('r4'), null, 'done', null, null)::text);
select t21_as(6);
select public.review_task_verification(t21_get('ned_r4')::uuid, 'approved', null);

do $$
begin
  if (select status from public.referrals where referred_id = u21(5)) <> 'pending' then
    raise exception 'FAIL: a 6th referral bonus in one day was paid';
  end if;
  raise notice 'PASS: at most 5 referral bonuses per referrer per day';
end $$;

update public.referrals set reward_issued_at = now() - interval '2 days'
where referrer_id = u21(4) and referred_id <> u21(5) and referred_id <> u21(9);
select t21_set('rex_before', t21_credits(4)::text);
select t21_set('ned_before', t21_credits(5)::text);
select t21_as(5);
select t21_set('ned_r5', public.submit_task_verification(t21_task('r5'), null, 'done', null, null)::text);
select t21_as(7);
select public.review_task_verification(t21_get('ned_r5')::uuid, 'approved', null);

do $$
begin
  if (select status from public.referrals where referred_id = u21(5)) <> 'rewarded' then
    raise exception 'FAIL: the referral bonus was not paid for an approval by an unconnected creator';
  end if;
  if t21_credits(4) <> t21_get('rex_before')::int + 20 or t21_credits(5) <> t21_get('ned_before')::int + 5 + 20 then
    raise exception 'FAIL: referral bonus amounts are wrong';
  end if;
  raise notice 'PASS: the bonus is paid once an unconnected creator approves the friend''s proof';
end $$;

-- ======================================================= 9. welcome bonus
insert into public.social_profiles (user_id, platform, username, profile_url)
values (u21(16), 'instagram', 'zoe', 'https://instagram.com/zoe');

select t21_as(1);
select t21_set('s1', public.create_campaign('Zoe 1', '', 'other', 'custom', 'https://example.com/z1', '', 'manual_proof', 2, 1)::text);
select t21_as(6);
select t21_set('s2', public.create_campaign('Zoe 2', '', 'other', 'custom', 'https://example.com/z2', '', 'manual_proof', 2, 1)::text);
select t21_set('s5', public.create_campaign('Zoe 5', '', 'other', 'custom', 'https://example.com/z5', '', 'manual_proof', 2, 1)::text);
select t21_as(7);
select t21_set('s3', public.create_campaign('Zoe 3', '', 'other', 'custom', 'https://example.com/z3', '', 'manual_proof', 2, 1)::text);
select t21_set('s4', public.create_campaign('Zoe 4', '', 'other', 'custom', 'https://example.com/z4', '', 'manual_proof', 2, 1)::text);
select t21_as(9);
select t21_set('s6', public.create_campaign('Zoe 6', '', 'other', 'custom', 'https://example.com/z6', '', 'manual_proof', 2, 1)::text);

select t21_as(16); -- zoe
do $$
begin
  for i in 1..6 loop
    perform t21_set('zoe_s' || i, public.submit_task_verification(t21_task('s' || i), null, 'done', null, null)::text);
  end loop;
end $$;

select t21_as(1);
select public.review_task_verification(t21_get('zoe_s1')::uuid, 'approved', null);
update public.task_completions set created_at = now() - interval '25 hours' where id = t21_get('zoe_s2')::uuid;
select public.auto_approve_overdue_completions(); -- ola never reviewed: automatic, doesn't count
select t21_as(7);
select public.review_task_verification(t21_get('zoe_s3')::uuid, 'approved', null);
select public.review_task_verification(t21_get('zoe_s4')::uuid, 'approved', null); -- same creator again

do $$
begin
  if exists (select 1 from public.credit_ledger where user_id = u21(16) and type = 'signup_bonus') then
    raise exception 'FAIL: the welcome bonus was paid after 2 creators (one automatic approval, one creator twice)';
  end if;
  raise notice 'PASS: automatic approvals and repeat creators don''t count toward the welcome bonus';
end $$;

select t21_as(6);
select public.review_task_verification(t21_get('zoe_s5')::uuid, 'approved', null);
select t21_as(9);
select public.review_task_verification(t21_get('zoe_s6')::uuid, 'approved', null);

select t21_as(16);
do $$
declare
  r record;
begin
  if (select count(*) from public.credit_ledger where user_id = u21(16) and type = 'signup_bonus' and amount = 10) <> 1 then
    raise exception 'FAIL: expected exactly one 10-credit welcome bonus';
  end if;
  if not exists (select 1 from public.notifications where user_id = u21(16) and title = 'Welcome bonus') then
    raise exception 'FAIL: zoe was not told about the welcome bonus';
  end if;
  select * into r from public.get_starter_bonus();
  if r.creators_done <> 3 or r.creators_needed <> 3 or r.amount <> 10 or r.granted_at is null then
    raise exception 'FAIL: get_starter_bonus gave % / % granted %', r.creators_done, r.creators_needed, r.granted_at;
  end if;
  if public.starter_bonus_creators(u21(5)) <> 2 then
    raise exception 'FAIL: ned''s approvals by rex and sam (his referral circle) should not count, got %',
      public.starter_bonus_creators(u21(5));
  end if;
  raise notice 'PASS: 10 welcome credits, once, after approvals by 3 unconnected creators';
end $$;

-- ================================================ fixes from the review
-- Trust isn't diluted by automatic approvals: 20 link-click style approvals
-- for uma (5 rejected of 6 reviewed by a person) leave her untrusted.
select t21_as(1);
do $$
begin
  for i in 1..20 loop
    perform t21_set('a' || i, public.create_campaign('Auto ' || i, '', 'other', 'visit',
      'https://example.com/auto/' || i, '', 'link_click', 1, 1)::text);
  end loop;
end $$;
insert into public.task_completions (task_id, user_id, status, reward_amount, auto_approved, reviewed_at)
select t21_task('a' || i), u21(8), 'approved', 1, true, now() from generate_series(1, 20) i;

do $$
begin
  if public.doer_is_trusted(u21(8)) then
    raise exception 'FAIL: automatic approvals diluted uma''s rejections';
  end if;
  raise notice 'PASS: only proofs a person reviewed count toward "often rejected"';
end $$;

-- A screenshot path already used (uploaded before fingerprints) is refused too.
select t21_as(3);
do $$
begin
  begin
    perform public.submit_task_verification(t21_task('c3'), null, null,
      u21(3) || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp', null);
    raise exception 'FAIL: an image path already used as proof was accepted again';
  exception when others then
    if sqlerrm not like 'DUPLICATE_PROOF%' and sqlerrm not like 'TASK_ALREADY_COMPLETED%' then raise; end if;
  end;
end $$;
select t21_as(1);
select t21_set('c8', public.create_campaign('Another shot', '', 'other', 'custom',
  'https://example.com/shot2', '', 'manual_proof', 5, 5)::text);
select t21_as(3);
do $$
begin
  begin
    perform public.submit_task_verification(t21_task('c8'), null, null,
      u21(3) || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp', null);
    raise exception 'FAIL: an image path already used as proof was accepted again';
  exception when others then
    if sqlerrm not like 'DUPLICATE_PROOF%' then raise; end if;
    raise notice 'PASS: the same image path can''t be used as proof twice, fingerprint or not';
  end;
end $$;

-- A referral code can't be claimed after one's first approval.
select t21_as(16); -- zoe has approvals
do $$
begin
  begin
    perform public.claim_referral((select referral_code from public.profiles where id = u21(4)));
    raise exception 'FAIL: a member with approved tasks claimed a referral code';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR: a referral code can only be used before your first approved task%' then raise; end if;
    raise notice 'PASS: referral codes only work before the first approved task';
  end;
end $$;

-- Deleting a member frees the places their waiting proofs held.
insert into auth.users (id, email) values (u21(17), 'u17@t21.example');
select t21_as(1);
select t21_set('c9', public.create_campaign('Delete check', '', 'other', 'custom',
  'https://example.com/del', '', 'manual_proof', 5, 3)::text);
select t21_set('c10', public.create_campaign('Delete check 2', '', 'other', 'custom',
  'https://example.com/del2', '', 'manual_proof', 5, 3)::text);
select t21_as(17);
select public.submit_task_verification(t21_task('c9'), null, 'done', null, null);
select public.submit_task_verification(t21_task('c10'), null, 'done', null, null);
select t21_as(1);
select public.cancel_campaign(t21_get('c10')::uuid, 'test');
select t21_set('cora_before', t21_credits(1)::text);
delete from auth.users where id = u21(17);

do $$
begin
  if (t21_campaign('c9')).reserved_count <> 0 then
    raise exception 'FAIL: a deleted member''s waiting proof still holds a place';
  end if;
  if (t21_campaign('c10')).reserved_count <> 0 or (t21_campaign('c10')).remaining_budget <> 0
     or t21_credits(1) <> t21_get('cora_before')::int + 5 then
    raise exception 'FAIL: on a cancelled campaign the kept reward should go back to the creator';
  end if;
  raise notice 'PASS: deleting a member frees their places (and returns kept money on a cancelled campaign)';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.log_audit_event(uuid, text, text, uuid, jsonb, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public.log_audit_event(uuid, text, text, uuid, jsonb, jsonb, text)', 'execute') then
    raise exception 'FAIL: clients can write audit entries';
  end if;
  raise notice 'PASS: only database functions can write the audit log';
end $$;

-- =============================================================== grants
do $$
begin
  if not has_function_privilege('authenticated', 'public.submit_task_verification(uuid, text, text, text, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.appeal_rejection(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.report_unfollow(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.doer_review_stats(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_proof_limits()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_starter_bonus()', 'execute') then
    raise exception 'FAIL: members are missing a grant they need';
  end if;
  if has_function_privilege('authenticated', 'public.release_completion_slot(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.try_starter_bonus(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.starter_bonus_creators(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.reward_task_completion(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.pay_approved_completion(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.appeal_rejection(uuid, text)', 'execute') then
    raise exception 'FAIL: an internal function is callable by members';
  end if;
  if has_table_privilege('authenticated', 'public.proof_images', 'select') then
    raise exception 'FAIL: members can read screenshot fingerprints';
  end if;
  if to_regprocedure('public.submit_task_verification(uuid, text, text, text)') is not null then
    raise exception 'FAIL: the old 4-argument submit_task_verification is still there';
  end if;
  raise notice 'PASS: grants - new entry points for members, internals closed';
end $$;

-- ===================================================== the books balance
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad from public.campaigns c
  where c.reserved_count <> (select count(*) from public.task_completions tc join public.tasks t on t.id = tc.task_id
                             where t.campaign_id = c.id and tc.status = 'pending' and tc.holds_slot)
     or c.completed_count + c.reserved_count > c.desired_completions
     or (c.status in ('active', 'paused') and c.remaining_budget < c.reward * c.reserved_count)
     or (c.status = 'cancelled' and c.remaining_budget <> c.reward * c.reserved_count);
  if v_bad > 0 then
    raise exception 'FAIL: % campaigns where held places and budget don''t add up', v_bad;
  end if;

  select count(*) into v_bad from public.profiles p
  where p.credits <> coalesce((select sum(amount) from public.credit_ledger l where l.user_id = p.id), 0);
  if v_bad > 0 then
    raise exception 'FAIL: % balances don''t match the ledger', v_bad;
  end if;

  select count(*) into v_bad from public.task_completions where holds_slot and status <> 'pending';
  if v_bad > 0 then
    raise exception 'FAIL: % reviewed proofs still hold a place', v_bad;
  end if;
  raise notice 'PASS: places, budgets and every balance still add up';
end $$;
