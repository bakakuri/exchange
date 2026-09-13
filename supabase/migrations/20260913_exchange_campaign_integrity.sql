-- Exchange campaign integrity migration.
-- Adds complete promotion fields, transaction audit fields, indexes,
-- and a safe owner cancellation/refund RPC.

alter table public.promotions add column if not exists title text;
alter table public.promotions add column if not exists platform text;
alter table public.promotions add column if not exists action text;
alter table public.promotions add column if not exists target_url text;
alter table public.promotions add column if not exists reward integer;
alter table public.promotions add column if not exists remaining_budget integer;
alter table public.tasks add column if not exists promotion_id uuid references public.promotions(id) on delete set null;

update public.promotions p
set title=coalesce(p.title,t.title,'კამპანია'),
    platform=coalesce(p.platform,t.platform,'Instagram'),
    action=coalesce(p.action,t.action,'Follow'),
    target_url=coalesce(p.target_url,t.target_url,'https://example.com/'),
    reward=coalesce(p.reward,t.reward,greatest(1,least(1000,floor(p.cost/10)::integer))),
    remaining_budget=coalesce(p.remaining_budget,p.cost)
from public.tasks t
where t.promotion_id=p.id;

update public.promotions
set title=coalesce(title,'კამპანია'),
    platform=coalesce(platform,'Instagram'),
    action=coalesce(action,'Follow'),
    target_url=coalesce(target_url,'https://example.com/'),
    reward=coalesce(reward,greatest(1,least(1000,floor(cost/10)::integer))),
    remaining_budget=coalesce(remaining_budget,cost);

alter table public.promotions drop constraint if exists promotions_platform_check;
alter table public.promotions add constraint promotions_platform_check check (platform in ('Instagram','TikTok','X','YouTube','Facebook'));
alter table public.promotions drop constraint if exists promotions_action_check;
alter table public.promotions add constraint promotions_action_check check (action in ('Follow','Subscribe','Like','Visit'));
alter table public.promotions drop constraint if exists promotions_reward_check;
alter table public.promotions add constraint promotions_reward_check check (reward>0 and reward<=1000);
alter table public.promotions drop constraint if exists promotions_remaining_budget_check;
alter table public.promotions add constraint promotions_remaining_budget_check check (remaining_budget>=0 and remaining_budget<=cost);

alter table public.credit_transactions add column if not exists reason text;
alter table public.credit_transactions add column if not exists admin_user_id uuid references public.profiles(id) on delete set null;
alter table public.credit_transactions drop constraint if exists credit_transactions_type_check;
alter table public.credit_transactions add constraint credit_transactions_type_check check (type in ('signup_bonus','task_reward','promotion_spend','promotion_refund','admin_adjustment'));

create index if not exists promotions_user_created_idx on public.promotions(user_id,created_at desc);
create index if not exists promotions_status_idx on public.promotions(status);
create index if not exists tasks_promotion_idx on public.tasks(promotion_id);
create index if not exists credit_transactions_user_created_idx on public.credit_transactions(user_id,created_at desc);

create or replace function public.cancel_promotion(p_promotion_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_remaining integer;
  v_status text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select remaining_budget,status into v_remaining,v_status
  from public.promotions
  where id=p_promotion_id and user_id=v_user
  for update;
  if v_status is null then raise exception 'Promotion not found'; end if;
  if v_status='completed' then raise exception 'Promotion is already completed'; end if;
  v_remaining:=greatest(0,coalesce(v_remaining,0));
  update public.promotions set remaining_budget=0,status='completed' where id=p_promotion_id;
  update public.tasks set status='completed' where promotion_id=p_promotion_id and status in ('active','paused');
  if v_remaining>0 then
    update public.profiles set credits=credits+v_remaining,updated_at=now() where id=v_user;
    insert into public.credit_transactions(user_id,amount,type,reason)
    values(v_user,v_remaining,'promotion_refund','Campaign cancellation refund');
  end if;
  return v_remaining;
end;
$$;

revoke all on function public.cancel_promotion(uuid) from public;
grant execute on function public.cancel_promotion(uuid) to authenticated;
