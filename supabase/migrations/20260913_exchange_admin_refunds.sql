-- Exchange admin campaign refund safeguard.
-- When an administrator removes an unfinished campaign, its unused budget
-- is returned to the campaign owner and recorded in the transaction ledger.

create or replace function public.admin_delete_promotion(p_promotion_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_admin uuid:=auth.uid();
  v_user uuid;
  v_remaining integer;
begin
  perform public.admin_guard();
  select user_id,greatest(0,coalesce(remaining_budget,0))
    into v_user,v_remaining
  from public.promotions
  where id=p_promotion_id
  for update;
  if v_user is null then raise exception 'Promotion not found'; end if;

  update public.promotions set remaining_budget=0,status='completed' where id=p_promotion_id;
  update public.tasks set status='completed' where promotion_id=p_promotion_id and status in ('active','paused');

  if v_remaining>0 then
    update public.profiles set credits=credits+v_remaining,updated_at=now() where id=v_user;
    insert into public.credit_transactions(user_id,amount,type,reason,admin_user_id)
    values(v_user,v_remaining,'promotion_refund','Admin campaign deletion refund',v_admin);
  end if;
  return v_remaining;
end;
$$;

revoke all on function public.admin_delete_promotion(uuid) from public;
grant execute on function public.admin_delete_promotion(uuid) to authenticated;
