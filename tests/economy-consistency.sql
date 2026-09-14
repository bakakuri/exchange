-- Exchange economy consistency checks.
-- Run in a non-production/test database after migrations.

begin;

-- 1. Required RPCs must exist exactly once by signature.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='complete_task'
        and pg_get_function_identity_arguments(p.oid)='p_task_id uuid') <> 1 then
    raise exception 'complete_task(uuid) is missing or duplicated';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='admin_set_task_status'
        and pg_get_function_identity_arguments(p.oid)='p_task_id uuid, p_status text') <> 1 then
    raise exception 'admin_set_task_status(uuid,text) is missing or duplicated';
  end if;
end $$;

-- 2. The final task function must be SECURITY DEFINER.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='complete_task'
      and pg_get_function_identity_arguments(p.oid)='p_task_id uuid'
      and p.prosecdef=true
  ) then raise exception 'complete_task must be SECURITY DEFINER'; end if;
end $$;

-- 3. Critical economic tables must have RLS enabled.
do $$
begin
  if exists (select 1 from pg_class where oid='public.credit_transactions'::regclass and relrowsecurity=false) then
    raise exception 'credit_transactions RLS is disabled';
  end if;
  if exists (select 1 from pg_class where oid='public.task_completions'::regclass and relrowsecurity=false) then
    raise exception 'task_completions RLS is disabled';
  end if;
end $$;

-- 4. The reward RPC must not be executable by anon/public.
do $$
begin
  if has_function_privilege('anon','public.complete_task(uuid)','execute') then
    raise exception 'anon can execute complete_task';
  end if;
  if has_function_privilege('public','public.complete_task(uuid)','execute') then
    raise exception 'public can execute complete_task';
  end if;
end $$;

rollback;
