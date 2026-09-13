-- Exchange Stage 2 smoke tests.
-- Run AFTER 20260913_exchange_stage2_ux.sql.
-- Read-only: does not create users, campaigns or transactions.

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from information_schema.tables
  where table_schema='public' and table_name='notifications';
  if v_count <> 1 then raise exception 'TEST FAILED: notifications table missing'; end if;

  select count(*) into v_count
  from pg_policies
  where schemaname='public' and tablename='notifications';
  if v_count < 3 then raise exception 'TEST FAILED: notifications RLS policies incomplete'; end if;

  select count(*) into v_count
  from pg_trigger
  where tgname='credit_transaction_notification';
  if v_count <> 1 then raise exception 'TEST FAILED: credit transaction notification trigger missing'; end if;

  select count(*) into v_count
  from pg_trigger
  where tgname='promotion_status_notification';
  if v_count <> 1 then raise exception 'TEST FAILED: promotion status notification trigger missing'; end if;

  raise notice 'Exchange Stage 2 UX smoke tests passed.';
end;
$$;

select tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename='notifications';
