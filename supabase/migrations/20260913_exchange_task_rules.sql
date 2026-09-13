-- Starter tasks are onboarding tasks created by Exchange and may be completed by the account owner.
-- Promotion tasks remain protected from self-completion.

create or replace function public.complete_task(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_reward integer;
  v_category text;
  v_completion uuid;
  v_promotion uuid;
  v_remaining integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select owner_id,reward,category,promotion_id
  into v_owner,v_reward,v_category,v_promotion
  from public.tasks
  where id=p_task_id and status='active';

  if v_reward is null then raise exception 'Task not found or inactive'; end if;
  if v_owner=v_user and coalesce(v_category,'')<>'Starter' then raise exception 'You cannot complete your own task'; end if;

  if exists(select 1 from public.task_completions where task_id=p_task_id and user_id=v_user) then
    raise exception 'Task already completed';
  end if;

  if v_promotion is not null then
    select remaining_budget into v_remaining
    from public.promotions
    where id=v_promotion and status='active'
    for update;

    if v_remaining is null then raise exception 'Promotion is no longer active'; end if;
    if v_remaining<v_reward then raise exception 'Promotion budget exhausted'; end if;

    update public.promotions
    set remaining_budget=remaining_budget-v_reward,
        status=case when remaining_budget-v_reward=0 then 'completed' else status end
    where id=v_promotion;
  end if;

  insert into public.task_completions(task_id,user_id,reward)
  values(p_task_id,v_user,v_reward)
  returning id into v_completion;

  update public.profiles
  set credits=credits+v_reward,updated_at=now()
  where id=v_user;

  insert into public.credit_transactions(user_id,amount,type,task_completion_id)
  values(v_user,v_reward,'task_reward',v_completion);

  if v_promotion is not null and v_remaining=v_reward then
    update public.tasks set status='completed' where id=p_task_id;
  end if;

  return v_reward;
end;
$$;

revoke all on function public.complete_task(uuid) from public;
grant execute on function public.complete_task(uuid) to authenticated;
