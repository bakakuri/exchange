-- 022_profiles_members_admin.sql
-- Profiles people recognise, a members directory, and the admin tools to
-- look after both.
--
--   1. Photos are uploaded, not linked. avatar_url and cover_url point
--      into the public "media" Storage bucket; only the API writes them
--      (it checks the image bytes first), so members can no longer set
--      them directly. Old links to other sites are cleared - they were
--      never shown, and a hotlinked picture tells another site who looked.
--   2. A field of work (profiles.category) the member picks: blogger,
--      musician, business, artist, gamer, sports, education, tech,
--      photographer, other.
--   3. Online status. member_presence keeps when each member was last
--      active (the API touches it at most once a minute). A member counts
--      as online for 5 minutes after that. profiles.show_online = false
--      hides both "online" and "last seen" from everyone else.
--   4. member_directory() lists active members with their photos, field,
--      presence (as allowed), level and counts, filtered by search, field
--      and automatic groups - online, creators (have campaigns), doers
--      (have approved tasks), new (joined in the last 7 days), top (the 50
--      with the most XP), admins. member_directory_counts() gives the
--      number in each group and field.
--   5. Admin tools: admin_update_profile() edits or cleans up a profile
--      (photos included) and tells the member why; admin_campaign_action()
--      pauses, resumes or cancels any campaign with a reason the creator
--      sees - a campaign a moderator paused stays paused until an admin
--      resumes it (campaigns.paused_by_admin); admin_send_message()
--      messages one member or everyone.
--
-- No new enum values: safe to run as one transaction (the Supabase SQL
-- editor does) and safe to run more than once.

-- ════════════════════════════════════════════════════════ requirements

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'campaigns'
                   and column_name = 'reserved_count') then
    raise exception 'Migration 021_trust_and_economy.sql has not been applied to this database. Run 020 and 021 first (or the combined 020+021 file), then run 022.';
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════ profile columns

alter table public.profiles
  add column if not exists cover_url text,
  add column if not exists category text,
  add column if not exists show_online boolean not null default true;

comment on column public.profiles.avatar_url is 'Public URL of the uploaded avatar (media bucket). Written only by the API.';
comment on column public.profiles.cover_url is 'Public URL of the uploaded cover photo (media bucket). Written only by the API.';
comment on column public.profiles.category is 'The member''s field of work, picked by them. See profile_category_known.';
comment on column public.profiles.show_online is 'false hides "online" and "last seen" from other members.';

-- Links to pictures elsewhere were never displayed; uploads replace them.
-- Only a file in the member's own folder of the media bucket is kept.
update public.profiles
set avatar_url = null
where avatar_url is not null
  and avatar_url !~ ('^https?://[^/?#]+/storage/v1/object/public/media/' || id::text
                     || '/avatar-[0-9a-f-]{36}\.(jpg|png|webp)$');

do $$
begin
  alter table public.profiles add constraint profile_category_known check (
    category is null or category in ('blogger', 'musician', 'business', 'artist', 'gamer',
                                     'sports', 'education', 'tech', 'photographer', 'other'));
exception when duplicate_object then null;
end;
$$;

do $$
begin
  -- http:// too: a local Supabase serves files from http://127.0.0.1.
  alter table public.profiles add constraint profile_photos_https check (
    (avatar_url is null or avatar_url ~ '^https?://') and (cover_url is null or cover_url ~ '^https?://'));
exception when duplicate_object then null;
end;
$$;

-- Members edit their own field and privacy; photos only through the API.
revoke update (avatar_url) on public.profiles from authenticated;
grant update (category, show_online) on public.profiles to authenticated;

-- ═════════════════════════════════════════════════════════════ presence

create table if not exists public.member_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

comment on table public.member_presence is
  'When each member was last active. Written by touch_presence() (API only); read through member_directory(), which honours show_online.';

alter table public.member_presence enable row level security;
revoke all on public.member_presence from anon, authenticated;

-- At most one write a minute per member, however many requests arrive.
create or replace function public.touch_presence(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.member_presence as mp (user_id, last_seen_at)
  select p_user_id, now()
  where exists (select 1 from public.profiles where id = p_user_id)
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at
    where mp.last_seen_at < now() - interval '50 seconds';
$$;

-- ════════════════════════════════════════════════════ members directory

-- Shared by the directory and its counts: every active member (or just
-- p_only) with what the caller may see of their presence, and the facts
-- the groups use. For one member the XP rank is counted directly instead
-- of ranking everyone.
create or replace function public.member_facts(p_only uuid default null)
returns table (
  id uuid,
  seen timestamptz,
  campaigns_count integer,
  completed_count integer,
  xp_rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
    case when p.show_online or p.id = auth.uid() then mp.last_seen_at end,
    (select count(*) from public.campaigns c where c.creator_id = p.id)::integer,
    (select count(*) from public.task_completions tc
      where tc.user_id = p.id and tc.status = 'approved')::integer,
    case when p_only is null then row_number() over (order by p.xp desc, p.created_at, p.id)
         else (select count(*) + 1 from public.profiles o
               where o.status = 'active'
                 and (o.xp > p.xp or (o.xp = p.xp and (o.created_at, o.id) < (p.created_at, p.id))))
    end
  from public.profiles p
  left join public.member_presence mp on mp.user_id = p.id
  where p.status = 'active' and (p_only is null or p.id = p_only);
$$;

create or replace function public.member_directory(
  p_search text default null,
  p_category text default null,
  p_segment text default null,
  p_sort text default null,
  p_limit integer default 24,
  p_offset integer default 0,
  p_username text default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  cover_url text,
  bio text,
  category text,
  country text,
  role user_role,
  level integer,
  xp integer,
  created_at timestamptz,
  is_online boolean,
  last_seen_at timestamptz,
  campaigns_count integer,
  completed_count integer,
  xp_rank bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with settings as (
    select
      coalesce(nullif(p_sort, ''),
        case p_segment when 'top' then 'level' when 'new' then 'new' else 'active' end) as sort,
      '%' || replace(replace(replace(nullif(trim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  matched as (
    select p.*, f.seen, f.campaigns_count as n_campaigns, f.completed_count as n_done, f.xp_rank as rank,
      coalesce(f.seen > now() - interval '5 minutes', false) as online
    from public.profiles p
    join public.member_facts(
      case when p_username is null then null
           else (select x.id from public.profiles x where x.username = p_username) end) f on f.id = p.id
    cross join settings s
    where (p_username is null or p.username = p_username)
      and (s.pattern is null or p.username ilike s.pattern or p.display_name ilike s.pattern)
      and (nullif(p_category, '') is null or p.category = p_category)
      and case nullif(p_segment, '')
            when 'online' then f.seen > now() - interval '5 minutes'
            when 'creators' then f.campaigns_count > 0
            when 'doers' then f.completed_count > 0
            when 'new' then p.created_at > now() - interval '7 days'
            when 'top' then p.xp > 0 and f.xp_rank <= 50
            when 'admins' then p.role = 'admin'
            else true
          end
  )
  select r.id, r.username, r.display_name, r.avatar_url, r.cover_url, r.bio, r.category, r.country,
    r.role, r.level, r.xp, r.created_at,
    case when r.seen is null then null else r.online end,
    r.seen, r.n_campaigns, r.n_done, r.rank,
    count(*) over ()
  from matched r cross join settings s
  order by
    case when s.sort = 'active' then r.online end desc nulls last,
    -- by the hour, so a member being active doesn't reshuffle the pages
    case when s.sort = 'active' then date_trunc('hour', r.seen) end desc nulls last,
    case when s.sort = 'level' then r.xp end desc nulls last,
    r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.member_directory_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with members as (
    select p.role, p.xp, p.category, p.created_at, f.*
    from public.profiles p
    join public.member_facts() f on f.id = p.id
  )
  select jsonb_build_object(
    'all', count(*),
    'online', count(*) filter (where seen > now() - interval '5 minutes'),
    'creators', count(*) filter (where campaigns_count > 0),
    'doers', count(*) filter (where completed_count > 0),
    'new', count(*) filter (where created_at > now() - interval '7 days'),
    'top', count(*) filter (where xp > 0 and xp_rank <= 50),
    'admins', count(*) filter (where role = 'admin'),
    'categories', coalesce((
      select jsonb_object_agg(category, n)
      from (select category, count(*) as n from members where category is not null group by category) c
    ), '{}'::jsonb)
  )
  from members;
$$;

-- ══════════════════════════════════════════════════════════ admin tools

-- Edit or clean up a member's profile. A null argument leaves that field
-- as it is; an empty string clears it. Returns the photo URLs it removed,
-- so the API can delete the files.
create or replace function public.admin_update_profile(
  p_target_user_id uuid,
  p_username text,
  p_display_name text,
  p_bio text,
  p_category text,
  p_remove_avatar boolean,
  p_remove_cover boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_before public.profiles;
  v_after public.profiles;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'VALIDATION_ERROR: a reason is required' using errcode = 'P0001';
  end if;

  select * into v_before from public.profiles where id = p_target_user_id for update;
  if not found then
    raise exception 'NOT_FOUND: user not found' using errcode = 'P0001';
  end if;

  if p_username is not null and p_username !~ '^[a-zA-Z0-9_]{3,30}$' then
    raise exception 'VALIDATION_ERROR: username must be 3-30 characters: letters, numbers, underscore only' using errcode = 'P0001';
  end if;
  if p_category is not null and p_category <> '' and p_category not in
       ('blogger', 'musician', 'business', 'artist', 'gamer', 'sports', 'education', 'tech', 'photographer', 'other') then
    raise exception 'VALIDATION_ERROR: unknown field of work' using errcode = 'P0001';
  end if;

  begin
    update public.profiles set
      username = coalesce(p_username, username),
      display_name = case when p_display_name is null then display_name else nullif(trim(p_display_name), '') end,
      bio = case when p_bio is null then bio else nullif(trim(p_bio), '') end,
      category = case when p_category is null then category else nullif(p_category, '') end,
      avatar_url = case when coalesce(p_remove_avatar, false) then null else avatar_url end,
      cover_url = case when coalesce(p_remove_cover, false) then null else cover_url end
    where id = p_target_user_id
    returning * into v_after;
  exception when unique_violation then
    raise exception 'VALIDATION_ERROR: that username is already taken' using errcode = 'P0001';
  end;

  -- Nothing actually changed: no audit entry, no notice (the update rolls back).
  if (v_after.username, v_after.display_name, v_after.bio, v_after.category, v_after.avatar_url, v_after.cover_url)
     is not distinct from
     (v_before.username, v_before.display_name, v_before.bio, v_before.category, v_before.avatar_url, v_before.cover_url) then
    raise exception 'VALIDATION_ERROR: Nothing to change' using errcode = 'P0001';
  end if;

  perform public.log_audit_event(v_admin_id, 'user.profile_moderated', 'user', p_target_user_id,
    jsonb_build_object('username', v_before.username, 'display_name', v_before.display_name, 'bio', v_before.bio,
                       'category', v_before.category, 'avatar_url', v_before.avatar_url, 'cover_url', v_before.cover_url),
    jsonb_build_object('username', v_after.username, 'display_name', v_after.display_name, 'bio', v_after.bio,
                       'category', v_after.category, 'avatar_url', v_after.avatar_url, 'cover_url', v_after.cover_url),
    p_reason);

  insert into public.notifications (user_id, type, title, body)
  values (p_target_user_id, 'admin_message', 'A moderator changed your profile', trim(p_reason));

  return jsonb_build_object(
    'removed_avatar_url', case when v_before.avatar_url is distinct from v_after.avatar_url then v_before.avatar_url end,
    'removed_cover_url', case when v_before.cover_url is distinct from v_after.cover_url then v_before.cover_url end);
end;
$$;

-- A campaign a moderator paused stays paused until an admin resumes it.
alter table public.campaigns
  add column if not exists paused_by_admin boolean not null default false;

comment on column public.campaigns.paused_by_admin is
  'true while a moderator''s pause holds: the creator can''t resume it (set_campaign_pause_state), only an admin can.';

-- Same as 015, plus: a creator can't resume a campaign a moderator paused,
-- and resuming clears the moderator's hold.
create or replace function public.set_campaign_pause_state(p_campaign_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_campaign public.campaigns;
begin
  if v_actor_id is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = p_campaign_id for update;

  if not found then
    raise exception 'NOT_FOUND: campaign not found' using errcode = 'P0001';
  end if;

  if v_campaign.creator_id <> v_actor_id and not public.is_admin() then
    raise exception 'FORBIDDEN: not the campaign owner' using errcode = 'P0001';
  end if;

  if v_campaign.status not in ('active', 'paused') then
    raise exception 'CAMPAIGN_%: campaign is not active or paused', upper(v_campaign.status::text)
      using errcode = 'P0001';
  end if;

  if not p_paused and v_campaign.paused_by_admin and not public.is_admin() then
    raise exception 'FORBIDDEN: a moderator paused this campaign - only an admin can resume it' using errcode = 'P0001';
  end if;

  update public.campaigns
  set status = (case when p_paused then 'paused' else 'active' end)::campaign_status,
      paused_by_admin = case when p_paused then paused_by_admin else false end
  where id = p_campaign_id;

  perform public.log_audit_event(v_actor_id,
    case when p_paused then 'campaign.paused' else 'campaign.resumed' end,
    'campaign', p_campaign_id, to_jsonb(v_campaign.status), null, null);
end;
$$;

-- Pause, resume or cancel any member's campaign; the creator sees why.
create or replace function public.admin_campaign_action(p_campaign_id uuid, p_action text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_campaign public.campaigns;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'VALIDATION_ERROR: a reason is required' using errcode = 'P0001';
  end if;
  if p_action is null or p_action not in ('pause', 'resume', 'cancel') then
    raise exception 'VALIDATION_ERROR: action must be pause, resume or cancel' using errcode = 'P0001';
  end if;

  select * into v_campaign from public.campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'NOT_FOUND: campaign not found' using errcode = 'P0001';
  end if;

  if p_action = 'pause' then
    if v_campaign.paused_by_admin then
      raise exception 'VALIDATION_ERROR: a moderator already paused this campaign' using errcode = 'P0001';
    end if;
    perform public.set_campaign_pause_state(p_campaign_id, true);
    update public.campaigns set paused_by_admin = true where id = p_campaign_id;
    insert into public.notifications (user_id, type, title, body, related_campaign_id)
    values (v_campaign.creator_id, 'admin_message', 'A moderator paused your campaign', trim(p_reason), p_campaign_id);
  elsif p_action = 'resume' then
    if v_campaign.status::text <> 'paused' then
      raise exception 'VALIDATION_ERROR: the campaign is not paused' using errcode = 'P0001';
    end if;
    perform public.set_campaign_pause_state(p_campaign_id, false);
    insert into public.notifications (user_id, type, title, body, related_campaign_id)
    values (v_campaign.creator_id, 'admin_message', 'A moderator resumed your campaign', trim(p_reason), p_campaign_id);
  else
    -- cancel_campaign() refunds, keeps what waiting proofs need and
    -- notifies the creator with the reason.
    perform public.cancel_campaign(p_campaign_id, trim(p_reason));
  end if;

  perform public.log_audit_event(v_admin_id, 'campaign.admin_' || p_action, 'campaign', p_campaign_id,
    null, null, p_reason);
end;
$$;

-- A message to one member (p_user_id) or to every active member (null).
-- Returns how many received it.
create or replace function public.admin_send_message(p_user_id uuid, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_sent integer;
begin
  if v_admin_id is null or not public.is_admin() then
    raise exception 'FORBIDDEN: admin privileges required' using errcode = 'P0001';
  end if;
  if length(v_title) < 1 or length(v_title) > 120 then
    raise exception 'VALIDATION_ERROR: the title must be 1-120 characters' using errcode = 'P0001';
  end if;
  if length(v_body) > 2000 then
    raise exception 'VALIDATION_ERROR: the message must be at most 2000 characters' using errcode = 'P0001';
  end if;

  if p_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'NOT_FOUND: user not found' using errcode = 'P0001';
    end if;
    insert into public.notifications (user_id, type, title, body)
    values (p_user_id, 'admin_message', v_title, v_body);
    v_sent := 1;
  else
    insert into public.notifications (user_id, type, title, body)
    select id, 'admin_message', v_title, v_body
    from public.profiles
    where status = 'active';
    get diagnostics v_sent = row_count;
  end if;

  perform public.log_audit_event(v_admin_id, 'admin.message',
    case when p_user_id is null then 'everyone' else 'user' end, p_user_id, null,
    jsonb_build_object('title', v_title, 'body', v_body, 'recipients', v_sent), null);

  return v_sent;
end;
$$;

-- ═══════════════════════════════════════════════════════════════ grants

revoke execute on function
  public.touch_presence(uuid),
  public.member_facts(uuid),
  public.member_directory(text, text, text, text, integer, integer, text),
  public.member_directory_counts(),
  public.admin_update_profile(uuid, text, text, text, text, boolean, boolean, text),
  public.admin_campaign_action(uuid, text, text),
  public.admin_send_message(uuid, text, text)
from public, anon, authenticated;

-- touch_presence and member_facts stay with the API (service role) and
-- the functions above; members read presence only through these:
grant execute on function public.member_directory(text, text, text, text, integer, integer, text) to authenticated;
grant execute on function public.member_directory_counts() to authenticated;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.admin_campaign_action(uuid, text, text) to authenticated;
grant execute on function public.admin_send_message(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════ storage bucket

-- Public: anyone may view the pictures (they are profile photos); only
-- the API (service role) writes, so no write policies are needed.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  else
    raise notice 'storage.buckets not found (not a Supabase database?) - skipping the media bucket';
  end if;
end;
$$;

create index if not exists idx_profiles_category on public.profiles (category) where category is not null;
create index if not exists idx_task_completions_user_status on public.task_completions (user_id, status);
