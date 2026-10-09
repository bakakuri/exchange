-- 023_messages.sql
-- Private messages between members: text, photos, videos, audio, files and
-- voice messages, with "seen" receipts, unread counts and blocking.
--
--   - One conversation per pair of members (conversations,
--     conversation_members). Each member's last_read_seq says how far they
--     have read: the other side's messages up to it show as "seen", later
--     ones count as unread.
--   - messages.seq orders messages; messages.change_seq moves on every
--     insert and delete, so an open chat asks only for what changed since
--     its last look (message_updates()).
--   - Files go straight from the browser into the private "chat" Storage
--     bucket through a one-time signed upload URL the API hands out to
--     members of the conversation, under "<conversation>/<sender>/<random>".
--     send_message() accepts only a file in the sender's own folder of that
--     conversation, uploaded and not used before. They are shown through
--     short-lived signed URLs.
--   - member_blocks: a member can block another; neither can then write to
--     the other (old messages stay readable).
--   - Everything goes through the functions below (auth.uid() decides who
--     is asking); the tables are closed to clients.
--
-- No new enum values: safe to run as one transaction, and more than once.

-- ════════════════════════════════════════════════════════ requirements

do $$
begin
  if to_regclass('public.member_presence') is null then
    raise exception 'Migration 022_profiles_members_admin.sql has not been applied to this database. Run 022 first, then run 023.';
  end if;
end;
$$;

-- ══════════════════════════════════════════════════════════════ tables

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversation_pair_ordered check (user_a < user_b),
  constraint conversation_pair_unique unique (user_a, user_b)
);

comment on table public.conversations is 'One per pair of members (user_a < user_b). Read and written only through the 023 functions.';

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_seq bigint not null default 0,
  primary key (conversation_id, user_id)
);

create index if not exists idx_conversation_members_user on public.conversation_members (user_id);

create sequence if not exists public.message_change_seq;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  change_seq bigint not null default nextval('public.message_change_seq'),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  body text,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  meta jsonb not null default '{}'::jsonb,
  client_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint message_kind_known check (kind in ('text', 'image', 'video', 'audio', 'voice', 'file')),
  constraint message_body_length check (body is null or length(body) <= 4000),
  constraint message_has_content check (
    deleted_at is not null
    or (kind = 'text' and length(btrim(coalesce(body, ''))) > 0)
    or (kind <> 'text' and attachment_path is not null)),
  constraint message_client_unique unique (sender_id, client_id)
);

comment on table public.messages is
  'Private messages. seq orders them; change_seq moves on insert and delete (message_updates()). A deleted message keeps its place with no content.';

create unique index if not exists idx_messages_seq on public.messages (seq);
create index if not exists idx_messages_conversation_seq on public.messages (conversation_id, seq desc);
create index if not exists idx_messages_conversation_change on public.messages (conversation_id, change_seq);
create unique index if not exists idx_messages_attachment on public.messages (attachment_path) where attachment_path is not null;

create table if not exists public.member_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint block_not_self check (blocker_id <> blocked_id)
);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.member_blocks enable row level security;
revoke all on public.conversations, public.conversation_members, public.messages, public.member_blocks
  from anon, authenticated;
revoke all on sequence public.message_change_seq from anon, authenticated;

-- ═════════════════════════════════════════════════════════════ helpers

-- A message as the API returns it.
create or replace function public.message_json(m public.messages)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', m.id, 'seq', m.seq, 'change_seq', m.change_seq, 'conversation_id', m.conversation_id,
    'sender_id', m.sender_id, 'kind', m.kind, 'body', m.body,
    'attachment_path', m.attachment_path, 'attachment_name', m.attachment_name,
    'attachment_type', m.attachment_type, 'attachment_size', m.attachment_size,
    'meta', m.meta, 'client_id', m.client_id, 'created_at', m.created_at, 'deleted_at', m.deleted_at);
$$;

-- The other side of a chat: name, photo, and presence as they allow it.
create or replace function public.member_card(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
    'active', p.status = 'active',
    'is_online', case when p.show_online then coalesce(mp.last_seen_at > now() - interval '5 minutes', false) end,
    'last_seen_at', case when p.show_online then mp.last_seen_at end)
  from public.profiles p
  left join public.member_presence mp on mp.user_id = p.id
  where p.id = p_user;
$$;

create or replace function public.is_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.member_blocks where blocker_id = p_blocker and blocked_id = p_blocked);
$$;

-- The other member of a conversation the caller belongs to (NOT_FOUND
-- otherwise, so ids of other people's chats reveal nothing).
create or replace function public.conversation_other(p_conversation_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;
  select o.user_id into v_other
  from public.conversation_members me
  join public.conversation_members o on o.conversation_id = me.conversation_id and o.user_id <> me.user_id
  where me.conversation_id = p_conversation_id and me.user_id = v_uid;
  if v_other is null then
    raise exception 'NOT_FOUND: conversation not found' using errcode = 'P0001';
  end if;
  return v_other;
end;
$$;

-- Can the caller write in this conversation right now? Returns the other
-- member. Used before a file upload and by send_message().
create or replace function public.assert_can_send(p_conversation_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid := public.conversation_other(p_conversation_id);
begin
  if public.is_blocked(v_uid, v_other) then
    raise exception 'FORBIDDEN: you blocked this member - unblock them to write' using errcode = 'P0001';
  end if;
  if public.is_blocked(v_other, v_uid) then
    raise exception 'FORBIDDEN: this member does not accept your messages' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = v_other and status = 'active') then
    raise exception 'FORBIDDEN: this member is not receiving messages' using errcode = 'P0001';
  end if;
  return v_other;
end;
$$;

-- ═══════════════════════════════════════════════════════ conversations

-- The conversation with p_other, created on first use.
create or replace function public.start_conversation(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;
  if p_other is null or p_other = v_uid then
    raise exception 'VALIDATION_ERROR: you cannot message yourself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_other and status = 'active') then
    raise exception 'NOT_FOUND: member not found' using errcode = 'P0001';
  end if;

  v_a := least(v_uid, p_other);
  v_b := greatest(v_uid, p_other);
  insert into public.conversations (user_a, user_b) values (v_a, v_b)
  on conflict (user_a, user_b) do nothing;
  select id into v_id from public.conversations where user_a = v_a and user_b = v_b;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, v_a), (v_id, v_b)
  on conflict do nothing;
  return v_id;
end;
$$;

-- The caller's conversations that have messages, newest first.
create or replace function public.list_conversations(p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(s.item order by s.last_message_at desc), '[]'::jsonb) into v_items
  from (
    select c.last_message_at, jsonb_build_object(
      'id', c.id,
      'last_message_at', c.last_message_at,
      'other', public.member_card(o.user_id),
      'last_message', (select public.message_json(m) from public.messages m
                       where m.conversation_id = c.id order by m.seq desc limit 1),
      'unread', (select count(*) from public.messages m
                 where m.conversation_id = c.id and m.sender_id <> v_uid
                   and m.seq > me.last_read_seq and m.deleted_at is null
                   and not public.is_blocked(v_uid, m.sender_id)),
      'other_read_seq', o.last_read_seq,
      'blocked_by_me', public.is_blocked(v_uid, o.user_id),
      'blocked_me', public.is_blocked(o.user_id, v_uid)) as item
    from public.conversation_members me
    join public.conversations c on c.id = me.conversation_id
    join public.conversation_members o on o.conversation_id = c.id and o.user_id <> v_uid
    where me.user_id = v_uid
      and c.last_message_at is not null
      and (p_before is null or c.last_message_at < p_before)
    order by c.last_message_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) s;
  return v_items;
end;
$$;

-- One conversation: who it is with, the receipts, and a page of messages
-- (the newest, or those before p_before_seq), oldest first.
create or replace function public.get_conversation(
  p_conversation_id uuid,
  p_before_seq bigint default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid := public.conversation_other(p_conversation_id);
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_page jsonb;
  v_count integer;
begin
  select coalesce(jsonb_agg(public.message_json(m) order by m.seq), '[]'::jsonb), count(*)
  into v_page, v_count
  from (
    select * from public.messages
    where conversation_id = p_conversation_id
      and (p_before_seq is null or seq < p_before_seq)
    order by seq desc
    limit v_limit + 1
  ) m;

  -- One extra row was read only to know whether there are more.
  if v_count > v_limit then
    v_page := v_page - 0;
  end if;

  return jsonb_build_object(
    'id', p_conversation_id,
    'other', public.member_card(v_other),
    'my_read_seq', (select last_read_seq from public.conversation_members
                    where conversation_id = p_conversation_id and user_id = v_uid),
    'other_read_seq', (select last_read_seq from public.conversation_members
                       where conversation_id = p_conversation_id and user_id = v_other),
    'change_cursor', (select coalesce(max(change_seq), 0) from public.messages where conversation_id = p_conversation_id),
    'blocked_by_me', public.is_blocked(v_uid, v_other),
    'blocked_me', public.is_blocked(v_other, v_uid),
    'has_more', v_count > v_limit,
    'messages', v_page);
end;
$$;

-- ════════════════════════════════════════════════════════════ messages

create or replace function public.send_message(
  p_conversation_id uuid,
  p_kind text,
  p_body text,
  p_attachment_path text default null,
  p_attachment_name text default null,
  p_attachment_type text default null,
  p_attachment_size bigint default null,
  p_meta jsonb default '{}'::jsonb,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
  v_uploaded boolean;
  v_message public.messages;
begin
  perform public.assert_can_send(p_conversation_id);
  -- One write at a time per conversation, so messages commit in the order
  -- of their numbers and a reader's cursor never skips one.
  perform 1 from public.conversations where id = p_conversation_id for update;

  -- The same message sent twice (a retry after a lost answer) is stored once.
  if p_client_id is not null then
    select * into v_message from public.messages where sender_id = v_uid and client_id = p_client_id;
    if found then
      return public.message_json(v_message);
    end if;
  end if;

  if p_kind is null or p_kind not in ('text', 'image', 'video', 'audio', 'voice', 'file') then
    raise exception 'VALIDATION_ERROR: unknown kind of message' using errcode = 'P0001';
  end if;
  if v_body is not null and length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: a message can be at most 4000 characters' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_meta) <> 'object' or length(v_meta::text) > 4000 then
    raise exception 'VALIDATION_ERROR: invalid message details' using errcode = 'P0001';
  end if;
  -- Only what the chat draws, as numbers: size, length, the voice waveform.
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'width', case when jsonb_typeof(v_meta->'width') = 'number' then v_meta->'width' end,
    'height', case when jsonb_typeof(v_meta->'height') = 'number' then v_meta->'height' end,
    'duration_ms', case when jsonb_typeof(v_meta->'duration_ms') = 'number' then v_meta->'duration_ms' end,
    'waveform', case when jsonb_typeof(v_meta->'waveform') = 'array'
                          and jsonb_array_length(v_meta->'waveform') <= 96
                          and not exists (select 1 from jsonb_array_elements(v_meta->'waveform') w
                                          where jsonb_typeof(w) <> 'number')
                     then v_meta->'waveform' end));

  if p_kind = 'text' then
    if v_body is null then
      raise exception 'VALIDATION_ERROR: write a message' using errcode = 'P0001';
    end if;
    if p_attachment_path is not null then
      raise exception 'VALIDATION_ERROR: a text message has no file' using errcode = 'P0001';
    end if;
  else
    if p_attachment_path is null
       or p_attachment_path !~ ('^' || p_conversation_id::text || '/' || v_uid::text || '/[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$') then
      raise exception 'VALIDATION_ERROR: invalid file' using errcode = 'P0001';
    end if;
    if p_attachment_name is null or length(p_attachment_name) = 0 or length(p_attachment_name) > 255
       or (p_attachment_type is not null and length(p_attachment_type) > 120)
       or coalesce(p_attachment_size, 0) < 0 then
      raise exception 'VALIDATION_ERROR: invalid file' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.messages where attachment_path = p_attachment_path) then
      raise exception 'VALIDATION_ERROR: this file was already sent' using errcode = 'P0001';
    end if;
    -- On Supabase the file must really be there.
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
        into v_uploaded using 'chat', p_attachment_path;
      if not v_uploaded then
        raise exception 'VALIDATION_ERROR: the file has not finished uploading' using errcode = 'P0001';
      end if;
    end if;
  end if;

  begin
    insert into public.messages (conversation_id, sender_id, kind, body, attachment_path, attachment_name,
                                 attachment_type, attachment_size, meta, client_id)
    values (p_conversation_id, v_uid, p_kind, v_body,
            case when p_kind = 'text' then null else p_attachment_path end,
            case when p_kind = 'text' then null else left(p_attachment_name, 255) end,
            case when p_kind = 'text' then null else p_attachment_type end,
            case when p_kind = 'text' then null else p_attachment_size end,
            v_meta, p_client_id)
    returning * into v_message;
  exception when unique_violation then
    -- Lost a race with the same retry: hand back the one that won.
    select * into v_message from public.messages where sender_id = v_uid and client_id = p_client_id;
    if not found then
      raise exception 'VALIDATION_ERROR: this file was already sent' using errcode = 'P0001';
    end if;
    return public.message_json(v_message);
  end;

  update public.conversations set last_message_at = v_message.created_at where id = p_conversation_id;
  -- Writing means having read everything before it.
  update public.conversation_members set last_read_seq = greatest(last_read_seq, v_message.seq)
  where conversation_id = p_conversation_id and user_id = v_uid;

  return public.message_json(v_message);
end;
$$;

-- Read up to p_seq (never beyond the last message, never backwards).
create or replace function public.mark_conversation_read(p_conversation_id uuid, p_seq bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_read bigint;
begin
  perform public.conversation_other(p_conversation_id);
  update public.conversation_members
  set last_read_seq = greatest(last_read_seq, least(coalesce(p_seq, 0),
        (select coalesce(max(seq), 0) from public.messages where conversation_id = p_conversation_id)))
  where conversation_id = p_conversation_id and user_id = v_uid
  returning last_read_seq into v_read;
  return v_read;
end;
$$;

-- Delete one's own message for both sides. Returns the file it had, so
-- the API can remove it from Storage.
create or replace function public.delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.messages;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;
  select * into v_message from public.messages where id = p_message_id for update;
  if not found or v_message.sender_id <> v_uid then
    raise exception 'NOT_FOUND: message not found' using errcode = 'P0001';
  end if;
  if v_message.deleted_at is not null then
    return jsonb_build_object('attachment_path', null);
  end if;
  -- In turn with sends in this conversation (see send_message).
  perform 1 from public.conversations where id = v_message.conversation_id for update;

  update public.messages
  set deleted_at = now(), body = null, attachment_path = null, attachment_name = null,
      attachment_type = null, attachment_size = null, meta = '{}'::jsonb,
      change_seq = nextval('public.message_change_seq')
  where id = p_message_id;

  return jsonb_build_object('attachment_path', v_message.attachment_path);
end;
$$;

-- What changed since the caller last looked, in one call:
--   latest_seq / unread  - for the badge;
--   incoming             - messages to the caller after p_since (for the
--                          pop-up), from members they haven't blocked;
--   conversation         - for an open chat: every message added or
--                          deleted after p_after_change, the other side's
--                          read receipt and presence, and the block state.
create or replace function public.message_updates(
  p_since bigint default null,
  p_conversation_id uuid default null,
  p_after_change bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_other uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'latest_seq', coalesce(max(m.seq), 0),
    'unread', count(*) filter (where m.sender_id <> v_uid and m.seq > cm.last_read_seq and m.deleted_at is null
                                 and not public.is_blocked(v_uid, m.sender_id)),
    'unread_conversations', count(distinct m.conversation_id)
                              filter (where m.sender_id <> v_uid and m.seq > cm.last_read_seq and m.deleted_at is null
                                        and not public.is_blocked(v_uid, m.sender_id)))
  into v_result
  from public.conversation_members cm
  join public.messages m on m.conversation_id = cm.conversation_id
  where cm.user_id = v_uid;

  if p_since is not null then
    v_result := v_result || jsonb_build_object('incoming', (
      select coalesce(jsonb_agg(s.item order by s.seq), '[]'::jsonb)
      from (
        select m.seq, public.message_json(m) || jsonb_build_object('sender', public.member_card(m.sender_id)) as item
        from public.conversation_members cm
        join public.messages m on m.conversation_id = cm.conversation_id
        where cm.user_id = v_uid and m.seq > p_since and m.sender_id <> v_uid and m.deleted_at is null
          and not public.is_blocked(v_uid, m.sender_id)
        order by m.seq
        limit 20
      ) s));
  end if;

  if p_conversation_id is not null then
    v_other := public.conversation_other(p_conversation_id);
    v_result := v_result || jsonb_build_object('conversation', jsonb_build_object(
      'id', p_conversation_id,
      'changes', (select coalesce(jsonb_agg(public.message_json(m) order by m.change_seq), '[]'::jsonb)
                  from (select * from public.messages
                        where conversation_id = p_conversation_id and change_seq > coalesce(p_after_change, 0)
                        order by change_seq limit 200) m),
      'other_read_seq', (select last_read_seq from public.conversation_members
                         where conversation_id = p_conversation_id and user_id = v_other),
      'other', public.member_card(v_other),
      'blocked_by_me', public.is_blocked(v_uid, v_other),
      'blocked_me', public.is_blocked(v_other, v_uid)));
  end if;

  return v_result;
end;
$$;

-- ═══════════════════════════════════════════════════════════════ blocks

create or replace function public.block_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;
  if p_user is null or p_user = v_uid then
    raise exception 'VALIDATION_ERROR: you cannot block yourself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'NOT_FOUND: member not found' using errcode = 'P0001';
  end if;
  insert into public.member_blocks (blocker_id, blocked_id) values (v_uid, p_user)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED: sign in required' using errcode = 'P0001';
  end if;
  delete from public.member_blocks where blocker_id = auth.uid() and blocked_id = p_user;
end;
$$;

-- ═══════════════════════════════════════════════════════════════ grants

revoke execute on function
  public.message_json(public.messages),
  public.member_card(uuid),
  public.is_blocked(uuid, uuid),
  public.conversation_other(uuid),
  public.assert_can_send(uuid),
  public.start_conversation(uuid),
  public.list_conversations(timestamptz, integer),
  public.get_conversation(uuid, bigint, integer),
  public.send_message(uuid, text, text, text, text, text, bigint, jsonb, uuid),
  public.mark_conversation_read(uuid, bigint),
  public.delete_message(uuid),
  public.message_updates(bigint, uuid, bigint),
  public.block_member(uuid),
  public.unblock_member(uuid)
from public, anon, authenticated;

grant execute on function public.assert_can_send(uuid) to authenticated;
grant execute on function public.start_conversation(uuid) to authenticated;
grant execute on function public.list_conversations(timestamptz, integer) to authenticated;
grant execute on function public.get_conversation(uuid, bigint, integer) to authenticated;
grant execute on function public.send_message(uuid, text, text, text, text, text, bigint, jsonb, uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid, bigint) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.message_updates(bigint, uuid, bigint) to authenticated;
grant execute on function public.block_member(uuid) to authenticated;
grant execute on function public.unblock_member(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════ storage bucket

-- Private. No size or type limit of its own: the project's global file
-- size limit (Storage settings in the Supabase dashboard) is the only one.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat', 'chat', false, null, null)
    on conflict (id) do update set public = false, file_size_limit = null, allowed_mime_types = null;
  else
    raise notice 'storage.buckets not found (not a Supabase database?) - skipping the chat bucket';
  end if;
end;
$$;
