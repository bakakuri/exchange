-- User-facing campaign status text for notifications.
create or replace function public.notify_promotion_status()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_status text;
begin
  if new.status is distinct from old.status then
    v_status:=case new.status when 'active' then 'აქტიური' when 'paused' then 'დაპაუზებული' when 'completed' then 'დასრულებული' when 'cancelled' then 'გაუქმებული' else new.status end;
    insert into public.notifications(user_id,type,title,body)
    values(new.user_id,'promotion','კამპანიის სტატუსი შეიცვალა',coalesce(new.title,'კამპანია')||': '||v_status);
  end if;
  return new;
end;
$$;
revoke all on function public.notify_promotion_status() from public,anon,authenticated;
