-- Exchange Stage 4 read-only smoke tests.
-- Run after the Stage 2 and Stage 4 migrations.

do $$
declare v_count integer;
begin
  select count(*) into v_count from information_schema.tables where table_schema='public' and table_name='notifications';
  if v_count<>1 then raise exception 'TEST FAILED: notifications table missing'; end if;
  select count(*) into v_count from pg_proc where pronamespace='public'::regnamespace and proname='set_my_promotion_status';
  if v_count<>1 then raise exception 'TEST FAILED: campaign pause/resume RPC missing'; end if;
  select count(*) into v_count from pg_indexes where schemaname='public' and indexname in ('tasks_active_created_idx','task_completions_user_created_idx','notifications_user_unread_created_idx');
  if v_count<3 then raise exception 'TEST FAILED: Stage 4 indexes missing'; end if;
  select count(*) into v_count from pg_policies where schemaname='public' and tablename='notifications' and policyname='notifications_insert_own';
  if v_count<>1 then raise exception 'TEST FAILED: notification insert policy missing'; end if;
  raise notice 'Exchange Stage 4 smoke tests passed.';
end;
$$;
