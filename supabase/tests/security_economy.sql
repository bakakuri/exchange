-- Exchange Stage 1 smoke tests.
-- Run this AFTER supabase/migrations/20260913_exchange_security_economy.sql.
-- These tests are read-only and do not create users, campaigns or transactions.

do $$
declare
  v_count integer;
  v_ok boolean;
begin
  select count(*) into v_count
  from information_schema.tables
  where table_schema='public'
    and table_name='audit_logs';
  if v_count <> 1 then raise exception 'TEST FAILED: audit_logs table missing'; end if;

  select count(*) into v_count
  from information_schema.tables
  where table_schema='public'
    and table_name='task_verifications';
  if v_count <> 1 then raise exception 'TEST FAILED: task_verifications table missing'; end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema='public'
    and table_name='credit_transactions'
    and column_name in ('reason','admin_user_id','promotion_id','balance_after');
  if v_count <> 4 then raise exception 'TEST FAILED: credit ledger columns missing'; end if;

  select public.exchange_valid_target_url('Instagram','https://instagram.com/example') into v_ok;
  if not v_ok then raise exception 'TEST FAILED: Instagram URL rejected'; end if;

  select public.exchange_valid_target_url('Instagram','https://example.com/') into v_ok;
  if v_ok then raise exception 'TEST FAILED: foreign domain accepted as Instagram'; end if;

  select public.exchange_valid_target_url('YouTube','https://youtu.be/example') into v_ok;
  if not v_ok then raise exception 'TEST FAILED: YouTube short URL rejected'; end if;

  select public.exchange_valid_target_url('X','https://x.com/example') into v_ok;
  if not v_ok then raise exception 'TEST FAILED: X URL rejected'; end if;

  select public.exchange_valid_target_url('Facebook','https://facebook.com/example') into v_ok;
  if not v_ok then raise exception 'TEST FAILED: Facebook URL rejected'; end if;

  select count(*) into v_count
  from pg_proc
  where pronamespace='public'::regnamespace
    and proname in (
      'create_promotion',
      'complete_task',
      'cancel_promotion',
      'credit_ledger_check',
      'submit_task_verification',
      'admin_review_task_verification'
    );
  if v_count < 6 then raise exception 'TEST FAILED: Stage 1 RPCs missing'; end if;

  select count(*) into v_count
  from pg_proc
  where pronamespace='public'::regnamespace
    and proname='admin_delete_promotion';
  if v_count <> 1 then raise exception 'TEST FAILED: refund-safe admin_delete_promotion missing'; end if;

  raise notice 'Exchange Stage 1 smoke tests passed.';
end;
$$;

-- Ledger reconciliation report. Every returned difference should be 0.
select *
from public.credit_ledger_check(null)
where difference <> 0;
