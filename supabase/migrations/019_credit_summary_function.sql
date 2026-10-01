-- 019_credit_summary_function.sql
-- Added in Stage 10 (reward engine), once there's a reason to show a
-- user what the reward engine has actually done for them - not just the
-- raw paginated ledger Stage 6 already exposes, but a total per
-- transaction type (how much they've earned from tasks, from referrals,
-- spent reserving campaigns, had refunded, and so on).
--
-- PostgREST/supabase-js has no GROUP BY in its query builder, so this is
-- a function rather than a view - the first genuinely aggregate read in
-- this codebase. It is NOT security definer: public.credit_ledger
-- already grants authenticated SELECT and already carries
-- credit_ledger_select_own (014_rls.sql), so there is no privilege here
-- this function needs that the caller doesn't already have directly -
-- unlike every security definer function in 015_functions.sql, which
-- exists specifically because the caller has no direct grant to do what
-- the function does. Running as invoker means RLS applies to its query
-- exactly as it would to a direct SELECT, as a second, structural
-- safeguard behind the explicit filter below.
--
-- The explicit "where user_id = auth.uid()" is still required despite
-- that RLS policy, and is not redundant with it: credit_ledger_select_own
-- also lets an admin see every user's rows, and without this filter an
-- admin calling this function would get a summary of the entire
-- platform's ledger instead of their own - this function is specifically
-- "my summary", not "every row I'm allowed to see".

create or replace function public.get_credit_summary()
returns table (
  type ledger_transaction_type,
  total_amount bigint,
  entry_count bigint
)
language sql
stable
set search_path = public
as $$
  select type, sum(amount)::bigint as total_amount, count(*)::bigint as entry_count
  from public.credit_ledger
  where user_id = auth.uid()
  group by type;
$$;

comment on function public.get_credit_summary() is 'Per-transaction-type totals for the caller''s own credit_ledger rows. Not security definer - relies on the existing authenticated grant and credit_ledger_select_own RLS policy, the same access the caller already has for a direct SELECT.';

-- PostgreSQL grants EXECUTE on a newly created function to PUBLIC by
-- default - unlike tables, which start with no privileges for anyone
-- but the owner. Every function in 015_functions.sql that isn't meant
-- to be internal-only revokes that implicit PUBLIC grant before
-- selectively re-granting (see its own revoke/grant block); this one
-- needs the same revoke-then-grant, not just a grant, or anon keeps its
-- default EXECUTE regardless of what's granted to authenticated
-- specifically. Caught by this function's own test
-- (004_credit_summary_test.sql), which is the first local test to
-- check anon's privilege on a function in this codebase rather than
-- just authenticated's - a gap that happened to be low-impact here
-- (auth.uid() resolves to null with no session, so the where clause
-- matches nothing), but the access-control hygiene matters regardless
-- of this function's particular blast radius.
revoke execute on function public.get_credit_summary() from public;
grant execute on function public.get_credit_summary() to authenticated;
