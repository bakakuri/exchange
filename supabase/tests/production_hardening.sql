do $$
declare v_count integer;
begin
  select count(*) into v_count
  from pg_policies
  where schemaname='public' and tablename='tasks'
    and policyname in ('tasks_insert_own','tasks_update_own');
  if v_count<>0 then raise exception 'TEST FAILED: direct task mutation policies still exist'; end if;

  select count(*) into v_count
  from pg_policies
  where schemaname='public' and tablename='promotions'
    and policyname='promotions_insert_own';
  if v_count<>0 then raise exception 'TEST FAILED: direct promotion insert policy still exists'; end if;

  select count(*) into v_count
  from pg_policies
  where schemaname='public' and tablename='profiles'
    and policyname='profiles_update_own';
  if v_count<>0 then raise exception 'TEST FAILED: direct profile update policy still exists'; end if;

  if not public.exchange_valid_target_url('Instagram','https://www.instagram.com/example/') then
    raise exception 'TEST FAILED: valid Instagram URL rejected';
  end if;
  if public.exchange_valid_target_url('Instagram','http://www.instagram.com/example/') then
    raise exception 'TEST FAILED: HTTP Instagram URL accepted';
  end if;
  if public.exchange_valid_target_url('Instagram','https://instagram.com.evil.example/') then
    raise exception 'TEST FAILED: lookalike Instagram host accepted';
  end if;

  select count(*) into v_count
  from pg_proc
  where pronamespace='public'::regnamespace
    and proname='update_my_profile';
  if v_count<>1 then raise exception 'TEST FAILED: protected profile RPC missing'; end if;

  raise notice 'Exchange production hardening smoke tests passed.';
end;
$$;
