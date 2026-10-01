-- 005_task_completions.sql
-- One row per user's attempt at a task. unique(task_id, user_id) is the
-- database-level duplicate-reward guard (section 15 of the spec): no
-- amount of client retries, double clicks or replayed requests can ever
-- produce a second row for the same user/task pair.

create type completion_status as enum ('pending', 'approved', 'rejected', 'expired');

create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status completion_status not null default 'pending',
  reward_amount integer not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  unique (task_id, user_id)
);

comment on table public.task_completions is 'One attempt per user per task. The unique(task_id, user_id) constraint is the sole authoritative duplicate-reward guard.';

-- Defense in depth: a campaign creator can never complete their own task,
-- enforced here as well as in the submit_task_verification() function
-- (015_functions.sql), since a check constraint alone cannot reach across
-- tables.
create or replace function public.prevent_self_task_completion()
returns trigger
language plpgsql
as $$
declare
  v_creator_id uuid;
begin
  select c.creator_id into v_creator_id
  from public.tasks t
  join public.campaigns c on c.id = t.campaign_id
  where t.id = new.task_id;

  if v_creator_id = new.user_id then
    raise exception 'SELF_TASK_FORBIDDEN: a campaign creator cannot complete their own task'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_prevent_self_task_completion
  before insert on public.task_completions
  for each row execute function public.prevent_self_task_completion();
