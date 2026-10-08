-- 020_verification_upgrades.sql
-- Four changes to how completed tasks are verified.
--
--   1. Auto-approval. A submission nobody reviews within 24 hours is
--      approved automatically - or marked expired if its campaign can no
--      longer pay (cancelled, completed, out of budget). The work is done
--      by auto_approve_overdue_completions(): pg_cron runs it every 15
--      minutes where the extension is available, and the API also runs
--      it before it shows submissions, so nothing depends on the
--      schedule alone.
--   2. Screenshot proof. task_verifications.proof_image_path points into
--      the private "proofs" Storage bucket. Only the API uploads there
--      (service role, under "<user id>/<random>.<ext>"); people see images
--      through short-lived signed URLs.
--   3. Creator track record. creator_review_stats() counts the proofs each
--      creator approved or rejected by hand, shown next to their tasks.
--   4. Link-click tasks. For Visit / View / Listen tasks a creator can pick
--      "link click": opening the link through Exchange is recorded
--      (record_task_link_click) and, 15 seconds later,
--      complete_link_click_task() pays the reward at once - a click can
--      prove a visit, never a follow, hence the task-type limit.
--
-- Safe to run more than once.

-- ═══════════════════════════════════════════════════════════════ columns

alter table public.task_completions
  add column if not exists auto_approved boolean not null default false;

comment on column public.task_completions.auto_approved is
  'Approved by the system (24 h without review, or a link-click task), not by the campaign creator.';

alter table public.task_verifications add column if not exists proof_image_path text;
alter table public.task_verifications add column if not exists link_clicked_at timestamptz;

alter table public.task_verifications drop constraint if exists proof_provided;
alter table public.task_verifications add constraint proof_provided check (
  proof_url is not null or proof_text is not null or proof_image_path is not null or link_clicked_at is not null
);

-- "<user uuid>/<uuid>.jpg|png|webp" - the only shape the API writes.
alter table public.task_verifications drop constraint if exists proof_image_path_format;
alter table public.task_verifications add constraint proof_image_path_format check (
  proof_image_path is null
  or proof_image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
);

-- A click can only prove a visit. NOT VALID: rows created before this
-- migration are left alone; every new or changed task is checked.
alter table public.tasks drop constraint if exists link_click_task_types;
alter table public.tasks add constraint link_click_task_types check (
  verification_method = 'manual_proof' or task_type in ('visit', 'view', 'listen')
) not valid;

-- ═══════════════════════════════════════════════════════ link-click log

create table if not exists public.task_link_clicks (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

comment on table public.task_link_clicks is
  'When a member first opened a link-click task''s link through Exchange. Written and read only by the functions below.';

alter table public.task_link_clicks enable row level security;
revoke all on public.task_link_clicks from anon, authenticated;

-- ═══════════════════════════════════════════════════════ storage bucket

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('proofs', 'proofs', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  else
    raise notice 'storage.buckets not found (not a Supabase database?) - skipping the proofs bucket';
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════ submit with image

-- Same rules as before (015_functions.sql), plus: a screenshot path is
-- accepted as proof, it must sit in the caller's own folder, and
-- link-click tasks are completed through complete_link_click_task().
drop function if exists public.submit_task_verification(uuid, text, text);

create or replace function public.submit_task_verification(
  p_task_id uuid,
  p_proof_url text,
  p_proof_text text,
  p_proof_image_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.tasks;
  v_campaign public.campaigns;
  v_completion_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'TASK_NOT_FOUND: task not found' using errcode = 'P0001';
  end if;

  if v_task.verification_method = 'link_click' then
    raise exception 'VALIDATION_ERROR: this task is completed by opening its link' using errcode = 'P0001';
  end if;

  if p_proof_url is null and p_proof_text is null and p_proof_image_path is null then
    raise exception 'VALIDATION_ERROR: add a link, a note or a screenshot as proof' using errcode = 'P0001';
  end if;

  if p_proof_image_path is not null and split_part(p_proof_image_path, '/', 1) <> v_user_id::text then
    raise exception 'VALIDATION_ERROR: invalid screenshot' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  if v_campaign.creator_id = v_user_id then
    raise exception 'SELF_TASK_FORBIDDEN: cannot complete your own task' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = v_user_id and status = 'active') then
    raise exception 'FORBIDDEN: account is not active' using errcode = 'P0001';
  end if;

  if v_campaign.status <> 'active' then
    raise exception 'TASK_NOT_AVAILABLE: campaign is not active' using errcode = 'P0001';
  end if;

  if v_campaign.completed_count >= v_campaign.desired_completions or v_campaign.remaining_budget < v_campaign.reward then
    raise exception 'TASK_NOT_AVAILABLE: no budget or completion slots remaining' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.task_completions where task_id = p_task_id and user_id = v_user_id) then
    raise exception 'TASK_ALREADY_COMPLETED: you have already submitted this task' using errcode = 'P0001';
  end if;

  insert into public.task_completions (task_id, user_id, status, reward_amount)
  values (p_task_id, v_user_id, 'pending', v_campaign.reward)
  returning id into v_completion_id;

  insert into public.task_verifications (completion_id, proof_url, proof_text, proof_image_path)
  values (v_completion_id, p_proof_url, p_proof_text, p_proof_image_path);

  insert into public.activity (user_id, type, related_task_id, related_campaign_id)
  values (v_user_id, 'verification_submitted', p_task_id, v_campaign.id);

  return v_completion_id;
end;
$$;

-- ═══════════════════════════════════════════════════════ link clicks

-- The shared checks for both link-click steps. Returns the task's campaign.
create or replace function public.check_link_click_task(p_task_id uuid, p_user_id uuid)
returns public.campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_campaign public.campaigns;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'TASK_NOT_FOUND: task not found' using errcode = 'P0001';
  end if;

  if v_task.verification_method <> 'link_click' then
    raise exception 'VALIDATION_ERROR: this task needs proof, not a link click' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = v_task.campaign_id;

  if v_campaign.creator_id = p_user_id then
    raise exception 'SELF_TASK_FORBIDDEN: cannot complete your own task' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active') then
    raise exception 'FORBIDDEN: account is not active' using errcode = 'P0001';
  end if;

  if v_campaign.status <> 'active' then
    raise exception 'TASK_NOT_AVAILABLE: campaign is not active' using errcode = 'P0001';
  end if;

  if v_campaign.completed_count >= v_campaign.desired_completions or v_campaign.remaining_budget < v_campaign.reward then
    raise exception 'TASK_NOT_AVAILABLE: no budget or completion slots remaining' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.task_completions where task_id = p_task_id and user_id = p_user_id) then
    raise exception 'TASK_ALREADY_COMPLETED: you have already submitted this task' using errcode = 'P0001';
  end if;

  return v_campaign;
end;
$$;

-- Step 1: the member opens the link through Exchange. The first click is
-- kept, so opening it again never restarts the wait.
create or replace function public.record_task_link_click(p_task_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clicked_at timestamptz;
begin
  perform public.check_link_click_task(p_task_id, v_user_id);

  insert into public.task_link_clicks (task_id, user_id)
  values (p_task_id, v_user_id)
  on conflict (task_id, user_id) do nothing;

  select clicked_at into v_clicked_at
  from public.task_link_clicks where task_id = p_task_id and user_id = v_user_id;

  return v_clicked_at;
end;
$$;

-- Step 2: at least 15 seconds after the click, the reward is paid at once
-- through the same reward engine a creator's approval uses.
create or replace function public.complete_link_click_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign public.campaigns;
  v_clicked_at timestamptz;
  v_completion_id uuid;
begin
  v_campaign := public.check_link_click_task(p_task_id, v_user_id);

  select clicked_at into v_clicked_at
  from public.task_link_clicks where task_id = p_task_id and user_id = v_user_id;

  if v_clicked_at is null then
    raise exception 'VALIDATION_ERROR: open the link first' using errcode = 'P0001';
  end if;

  if now() - v_clicked_at < interval '15 seconds' then
    raise exception 'VALIDATION_ERROR: keep the page open for at least 15 seconds' using errcode = 'P0001';
  end if;

  insert into public.task_completions (task_id, user_id, status, reward_amount, auto_approved)
  values (p_task_id, v_user_id, 'pending', v_campaign.reward, true)
  returning id into v_completion_id;

  insert into public.task_verifications (completion_id, link_clicked_at)
  values (v_completion_id, v_clicked_at);

  insert into public.activity (user_id, type, related_task_id, related_campaign_id)
  values (v_user_id, 'verification_submitted', p_task_id, v_campaign.id);

  perform public.reward_task_completion(v_completion_id, null);

  return v_completion_id;
end;
$$;

-- ═══════════════════════════════════════════════════════ auto-approval

-- Pending submissions older than 24 hours: approve them, or expire them
-- when the campaign can no longer pay. Oldest first, a batch at a time,
-- skipping rows another run is already handling.
create or replace function public.auto_approve_overdue_completions(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_done integer := 0;
begin
  for r in
    select tc.id, tc.user_id, tc.task_id, t.campaign_id
    from public.task_completions tc
    join public.tasks t on t.id = tc.task_id
    where tc.status = 'pending'
      and tc.created_at < now() - interval '24 hours'
    order by tc.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update of tc skip locked
  loop
    begin
      perform public.reward_task_completion(r.id, null);
      update public.task_completions set auto_approved = true where id = r.id;
      perform public.log_audit_event(null, 'verification.auto_approved', 'task_completion', r.id,
        null, null, 'not reviewed within 24 hours');
      v_done := v_done + 1;
    exception
      when sqlstate 'P0001' then
        if sqlerrm like 'CAMPAIGN\_%' or sqlerrm like 'INSUFFICIENT\_BUDGET%' then
          update public.task_completions
          set status = 'expired', reviewed_at = now()
          where id = r.id and status = 'pending';

          insert into public.notifications (user_id, type, title, body, related_task_id, related_campaign_id, dedup_key)
          values (r.user_id, 'verification_rejected', 'Submission expired',
            'The campaign ended before your proof was reviewed.', r.task_id, r.campaign_id,
            'completion:' || r.id || ':expired')
          on conflict do nothing;

          perform public.log_audit_event(null, 'verification.expired', 'task_completion', r.id, null, null, sqlerrm);
          v_done := v_done + 1;
        else
          raise warning 'auto-approval skipped completion %: %', r.id, sqlerrm;
        end if;
    end;
  end loop;

  return v_done;
end;
$$;

-- ═══════════════════════════════════════════════ creator track record

-- Proofs each creator approved or rejected by hand. System approvals
-- (24 h timeout, link clicks) say nothing about the creator and are left
-- out. Aggregates only - no row of anyone's submissions is exposed.
create or replace function public.creator_review_stats(p_creator_ids uuid[])
returns table (creator_id uuid, approved bigint, rejected bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.creator_id,
         count(*) filter (where tc.status = 'approved'),
         count(*) filter (where tc.status = 'rejected')
  from public.task_completions tc
  join public.tasks t on t.id = tc.task_id
  join public.campaigns c on c.id = t.campaign_id
  where c.creator_id = any (p_creator_ids[1:100])
    and tc.status in ('approved', 'rejected')
    and not tc.auto_approved
  group by c.creator_id;
$$;

-- ════════════════════════════════════════════════ completion_details

-- Same view as 018, with the new fields appended at the end (a view can
-- only grow at the end when it is replaced).
create or replace view public.completion_details
with (security_invoker = true)
as
select
  tc.id,
  tc.task_id,
  tc.user_id as completer_id,
  tc.status,
  tc.reward_amount,
  tc.created_at,
  tc.reviewed_at,
  tc.reviewed_by,
  t.campaign_id,
  t.platform,
  t.task_type,
  t.target_url,
  c.creator_id as campaign_creator_id,
  c.title as campaign_title,
  tv.proof_url,
  tv.proof_text,
  tv.submitted_at,
  tv.review_notes,
  tc.auto_approved,
  tv.proof_image_path,
  tv.link_clicked_at,
  t.verification_method
from public.task_completions tc
join public.tasks t on t.id = tc.task_id
join public.campaigns c on c.id = t.campaign_id
join public.task_verifications tv on tv.completion_id = tc.id;

grant select on public.completion_details to authenticated;

-- ═══════════════════════════════════════════════════════════ grants

revoke execute on function
  public.submit_task_verification(uuid, text, text, text),
  public.check_link_click_task(uuid, uuid),
  public.record_task_link_click(uuid),
  public.complete_link_click_task(uuid),
  public.auto_approve_overdue_completions(integer),
  public.creator_review_stats(uuid[])
from public, anon, authenticated;

grant execute on function public.submit_task_verification(uuid, text, text, text) to authenticated;
grant execute on function public.record_task_link_click(uuid) to authenticated;
grant execute on function public.complete_link_click_task(uuid) to authenticated;
grant execute on function public.creator_review_stats(uuid[]) to authenticated;
-- auto_approve_overdue_completions: Supabase's service_role (the API) and
-- pg_cron (runs as postgres) keep their default access; members get none.

-- ══════════════════════════════════════════════════════════ schedule

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('exchange-auto-approve', '*/15 * * * *',
      'select public.auto_approve_overdue_completions()');
  else
    raise notice 'pg_cron is not available - auto-approval runs whenever the API lists submissions';
  end if;
exception when others then
  raise notice 'Could not schedule auto-approval with pg_cron (%) - the API still runs it', sqlerrm;
end;
$$;
