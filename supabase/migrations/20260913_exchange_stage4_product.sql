-- Exchange Stage 4 database support.
-- Run after 20260913_exchange_stage2_ux.sql.

create index if not exists tasks_active_created_idx on public.tasks(status,created_at desc);
create index if not exists task_completions_user_created_idx on public.task_completions(user_id,completed_at desc);
create index if not exists notifications_user_unread_created_idx on public.notifications(user_id,read_at,created_at desc);

create or replace function public.set_my_promotion_status(p_promotion_id uuid,p_status text)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_current text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_status not in ('active','paused') then raise exception 'Invalid campaign status'; end if;
  select status into v_current from public.promotions where id=p_promotion_id and user_id=v_user for update;
  if v_current is null then raise exception 'Campaign not found'; end if;
  if v_current in ('completed','cancelled') then raise exception 'Campaign cannot be changed'; end if;
  update public.promotions set status=p_status where id=p_promotion_id;
  update public.tasks set status=p_status where promotion_id=p_promotion_id and status in ('active','paused');
  perform public.write_audit_log(case when p_status='paused' then 'promotion_paused' else 'promotion_resumed' end,'promotion',p_promotion_id,v_user,null,'Campaign status changed by owner',null);
  return p_status;
end;
$$;
revoke all on function public.set_my_promotion_status(uuid,text) from public;
grant execute on function public.set_my_promotion_status(uuid,text) to authenticated;
