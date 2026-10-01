-- 000_supabase_stub.sql
-- NOT part of the real project. Stands in for the pieces a real Supabase
-- project provides for free (the auth schema, auth.uid(), and the
-- authenticated/anon roles), so migrations 001-016 can be validated
-- against a real local Postgres before being applied to a live project.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Simulates the JWT-derived current user. Tests switch identity with:
--   select set_config('app.current_user_id', '<uuid>', false);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- A real Supabase project grants anon/authenticated USAGE on schema
-- auth and EXECUTE on auth.uid() (and auth.role()/auth.jwt()) by
-- default, precisely so it can be called directly - not just from
-- inside a security definer function or a pre-resolved RLS policy
-- expression - from ordinary SQL and RLS policies alike. This stub
-- went without that grant from Stage 2 through Stage 9 without anyone
-- noticing, because every function that calls auth.uid() here has
-- been security definer (runs as postgres, the owner, needing no grant
-- of its own) and every RLS policy's use of auth.uid() is resolved
-- once, under postgres's privileges, at CREATE POLICY time - neither
-- case ever required the *querying* role to resolve the name itself.
-- Stage 10's get_credit_summary() is the first plain (non-security-
-- definer) function whose body calls auth.uid() directly, and calling
-- it as `authenticated` failed here with "permission denied for schema
-- auth" - not a bug in that function (it is deliberately not security
-- definer, since it needs no privilege the caller doesn't already have
-- - see that migration's comment), but a gap in this stub not
-- reflecting what a real Supabase project already grants. Comes after
-- the role creation below, not before - these roles don't exist yet at
-- this point in the file, and `grant ... to` a role that doesn't exist
-- fails outright.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
