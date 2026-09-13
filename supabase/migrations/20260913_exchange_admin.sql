-- Exchange admin controls
-- Run this migration in Supabase SQL Editor.
-- Admin access is decided by public.profiles.role = 'admin'.

create or replace function public.admin_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admin access required';
  end if;
end;
$$;

revoke all on function public.admin_guard() from public;
grant execute on function public.admin_guard() to authenticated;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.admin_guard();
  select jsonb_build_object(
    'users', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select p.id, p.username, p.display_name, p.role, p.credits, p.created_at,
             u.email,
             (select count(*) from public.social_profiles sp where sp.user_id=p.id) as profile_count,
             (select count(*) from public.task_completions tc where tc.user_id=p.id) as completed_count
      from public.profiles p
      left join auth.users u on u.id=p.id
    ) x), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select t.id, t.owner_id, t.title, t.platform, t.action, t.reward, t.status, t.created_at,
             p.username as owner_username
      from public.tasks t
      left join public.profiles p on p.id=t.owner_id
    ) x), '[]'::jsonb),
    'promotions', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select p.id, p.user_id, p.title, p.platform, p.action, p.cost, p.reward,
             p.remaining_budget, p.status, p.created_at,
             pr.username as owner_username
      from public.promotions p
      left join public.profiles pr on pr.id=p.user_id
    ) x), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select ct.id, ct.user_id, ct.amount, ct.type, ct.created_at, p.username
      from public.credit_transactions ct
      left join public.profiles p on p.id=ct.user_id
      order by ct.created_at desc
      limit 100
    ) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  if p_role not in ('user','admin') then raise exception 'Invalid role'; end if;
  if p_username is null or length(trim(p_username)) < 3 then raise exception 'Username is too short'; end if;
  update public.profiles
  set username=trim(p_username), display_name=coalesce(nullif(trim(p_display_name),''),trim(p_username)), role=p_role, updated_at=now()
  where id=p_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'Admin adjustment'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_new integer;
begin
  perform public.admin_guard();
  if p_amount = 0 then raise exception 'Amount cannot be zero'; end if;
  update public.profiles
  set credits=credits+p_amount, updated_at=now()
  where id=p_user_id and credits+p_amount >= 0
  returning credits into v_new;
  if v_new is null then raise exception 'User not found or balance cannot become negative'; end if;
  insert into public.credit_transactions(user_id,amount,type)
  values(p_user_id,p_amount,'admin_adjustment');
  return v_new;
end;
$$;

create or replace function public.admin_set_task_status(p_task_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  if p_status not in ('active','paused','completed') then raise exception 'Invalid task status'; end if;
  update public.tasks set status=p_status where id=p_task_id;
  if not found then raise exception 'Task not found'; end if;
end;
$$;

create or replace function public.admin_delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  delete from public.tasks where id=p_task_id;
  if not found then raise exception 'Task not found'; end if;
end;
$$;

create or replace function public.admin_set_promotion_status(p_promotion_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  if p_status not in ('active','paused','completed') then raise exception 'Invalid promotion status'; end if;
  update public.promotions set status=p_status where id=p_promotion_id;
  if not found then raise exception 'Promotion not found'; end if;
  update public.tasks set status=p_status where promotion_id=p_promotion_id;
end;
$$;

create or replace function public.admin_delete_promotion(p_promotion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  delete from public.tasks where promotion_id=p_promotion_id;
  delete from public.promotions where id=p_promotion_id;
  if not found then raise exception 'Promotion not found'; end if;
end;
$$;

create or replace function public.admin_toggle_social_profile(p_profile_id uuid,p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  update public.social_profiles set active=p_active where id=p_profile_id;
  if not found then raise exception 'Profile not found'; end if;
end;
$$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_guard();
  if p_user_id=auth.uid() then raise exception 'You cannot delete your own admin account'; end if;
  delete from auth.users where id=p_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

revoke all on function public.admin_overview() from public;
revoke all on function public.admin_update_user(uuid,text,text,text) from public;
revoke all on function public.admin_adjust_credits(uuid,integer,text) from public;
revoke all on function public.admin_set_task_status(uuid,text) from public;
revoke all on function public.admin_delete_task(uuid) from public;
revoke all on function public.admin_set_promotion_status(uuid,text) from public;
revoke all on function public.admin_delete_promotion(uuid) from public;
revoke all on function public.admin_toggle_social_profile(uuid,boolean) from public;
revoke all on function public.admin_delete_user(uuid) from public;

grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_update_user(uuid,text,text,text) to authenticated;
grant execute on function public.admin_adjust_credits(uuid,integer,text) to authenticated;
grant execute on function public.admin_set_task_status(uuid,text) to authenticated;
grant execute on function public.admin_delete_task(uuid) to authenticated;
grant execute on function public.admin_set_promotion_status(uuid,text) to authenticated;
grant execute on function public.admin_delete_promotion(uuid) to authenticated;
grant execute on function public.admin_toggle_social_profile(uuid,boolean) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
