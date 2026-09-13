-- Creates visible starter tasks for each new user so a fresh account is not empty.
-- Starter tasks are onboarding tasks and may be completed by their owner once.

create or replace function public.seed_starter_tasks(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  select p_user,'Instagram','Follow','https://www.instagram.com/','გამოიწერე Exchange-ის Instagram','Starter',8,'active'
  where not exists (select 1 from public.tasks where owner_id=p_user and category='Starter' and title='გამოიწერე Exchange-ის Instagram');

  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  select p_user,'YouTube','Subscribe','https://www.youtube.com/','გამოიწერე Exchange-ის YouTube არხი','Starter',10,'active'
  where not exists (select 1 from public.tasks where owner_id=p_user and category='Starter' and title='გამოიწერე Exchange-ის YouTube არხი');

  insert into public.tasks(owner_id,platform,action,target_url,title,category,reward,status)
  select p_user,'TikTok','Follow','https://www.tiktok.com/','გამოიწერე Exchange-ის TikTok','Starter',8,'active'
  where not exists (select 1 from public.tasks where owner_id=p_user and category='Starter' and title='გამოიწერე Exchange-ის TikTok');
end;
$$;

revoke all on function public.seed_starter_tasks(uuid) from public;
grant execute on function public.seed_starter_tasks(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id,username,display_name,credits)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username',split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),
    100
  )
  on conflict (id) do nothing;

  insert into public.credit_transactions(user_id,amount,type)
  values(new.id,100,'signup_bonus');

  perform public.seed_starter_tasks(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Also repair accounts created before this migration.
do $$
declare r record;
begin
  for r in select id from public.profiles loop
    perform public.seed_starter_tasks(r.id);
  end loop;
end;
$$;
