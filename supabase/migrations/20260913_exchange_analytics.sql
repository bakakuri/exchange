-- Private analytics for the authenticated promotion owner.
-- Run after 20260913_exchange_v2_hardening.sql.

create or replace function public.get_my_analytics()
returns table(
  promotion_id uuid,
  completions bigint,
  credits_awarded bigint,
  remaining_budget integer
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    count(tc.id)::bigint,
    coalesce(sum(tc.reward), 0)::bigint,
    coalesce(p.remaining_budget, p.cost)
  from public.promotions p
  left join public.tasks t on t.promotion_id = p.id
  left join public.task_completions tc on tc.task_id = t.id
  where p.user_id = auth.uid()
  group by p.id, p.remaining_budget, p.cost
  order by p.created_at desc;
$$;

revoke all on function public.get_my_analytics() from public;
grant execute on function public.get_my_analytics() to authenticated;
