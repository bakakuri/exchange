-- 014_messages_test.sql
-- 023_messages.sql: starting a conversation, sending every kind of
-- message, file path rules, retries, read receipts and unread counts,
-- the poll (message_updates), deleting, blocking, and that the tables
-- are closed to clients.
-- Same conventions as 001: app.current_user_id stands in for auth.uid(),
-- every check RAISEs NOTICE 'PASS' or an EXCEPTION.

\set ON_ERROR_STOP on

create or replace function u23(n integer) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-0000-' || lpad((3000 + n)::text, 12, '0'))::uuid $$;
create or replace function t23_as(n integer) returns text language sql as
  $$ select set_config('app.current_user_id', u23(n)::text, false) $$;
create temporary table t23 (key text primary key, value text);
create or replace function t23_get(p_key text) returns text language sql as
  $$ select value from t23 where key = p_key $$;
create or replace function t23_set(p_key text, p_value text) returns void language sql as
  $$ insert into t23 values (p_key, p_value) on conflict (key) do update set value = excluded.value $$;
create or replace function t23_path(p_conv text, n integer, p_ext text) returns text language sql as
  $$ select p_conv || '/' || u23(n) || '/' || gen_random_uuid() || p_ext $$;

-- people: 1 nia, 2 oto, 3 pia (suspended later), 4 rati
insert into auth.users (id, email) select u23(n), 'c' || n || '@t23.example' from generate_series(1, 4) n;

-- ============================================================ start
select t23_as(1);
select t23_set('c12', public.start_conversation(u23(2))::text);

do $$
begin
  if public.start_conversation(u23(2))::text <> t23_get('c12') then
    raise exception 'FAIL: starting again should return the same conversation';
  end if;
  perform set_config('app.current_user_id', u23(2)::text, false);
  if public.start_conversation(u23(1))::text <> t23_get('c12') then
    raise exception 'FAIL: the other side should get the same conversation';
  end if;
  perform set_config('app.current_user_id', u23(1)::text, false);
  begin
    perform public.start_conversation(u23(1));
    raise exception 'FAIL: a conversation with oneself';
  exception when others then
    if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  if jsonb_array_length(public.list_conversations()) <> 0 then
    raise exception 'FAIL: an empty conversation should not be listed';
  end if;
  raise notice 'PASS: one conversation per pair, created on first use';
end $$;

-- ============================================================ send
do $$
declare v jsonb; v2 jsonb; c uuid := t23_get('c12')::uuid; client uuid := gen_random_uuid();
begin
  v := public.send_message(c, 'text', '  Hello Oto!  ', p_client_id => client);
  if v->>'body' <> 'Hello Oto!' or v->>'kind' <> 'text' then
    raise exception 'FAIL: text message %', v;
  end if;
  v2 := public.send_message(c, 'text', 'Hello Oto!', p_client_id => client);
  if v2->>'id' <> v->>'id' then
    raise exception 'FAIL: a retry with the same client id must not send twice';
  end if;
  perform t23_set('m1', v->>'id');
  perform t23_set('seq1', v->>'seq');

  begin
    perform public.send_message(c, 'text', '   ');
    raise exception 'FAIL: an empty message';
  exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.send_message(c, 'text', repeat('x', 4001));
    raise exception 'FAIL: a too-long message';
  exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  begin
    perform public.send_message(c, 'shout', 'hey');
    raise exception 'FAIL: an unknown kind';
  exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  raise notice 'PASS: text messages, retries stored once, limits';
end $$;

do $$
declare v jsonb; c uuid := t23_get('c12')::uuid; p text;
begin
  p := t23_path(c::text, 1, '.webm');
  v := public.send_message(c, 'voice', null, p, 'voice.webm', 'audio/webm', 48213,
                           '{"duration_ms": 7300, "waveform": [10, 40, 80]}'::jsonb);
  if v->>'attachment_path' <> p or (v->'meta'->>'duration_ms')::int <> 7300 then
    raise exception 'FAIL: voice message %', v;
  end if;
  begin
    perform public.send_message(c, 'voice', null, p, 'voice.webm', 'audio/webm', 48213, '{}');
    raise exception 'FAIL: the same file sent twice';
  exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  -- someone else's folder, another conversation, a path trick, no file
  foreach p in array array[
    t23_path(c::text, 2, '.jpg'),
    t23_path(gen_random_uuid()::text, 1, '.jpg'),
    c::text || '/' || u23(1) || '/../x.jpg',
    c::text || '/' || u23(1) || '/' || gen_random_uuid() || '.php.jpg/x'
  ] loop
    begin
      perform public.send_message(c, 'image', null, p, 'x.jpg', 'image/jpeg', 10, '{}');
      raise exception 'FAIL: accepted the path %', p;
    exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
    end;
  end loop;
  begin
    perform public.send_message(c, 'file', null, null, 'x.pdf', 'application/pdf', 10, '{}');
    raise exception 'FAIL: a file message without a file';
  exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  v := public.send_message(c, 'file', 'The contract', t23_path(c::text, 1, '.pdf'), 'contract.pdf', 'application/pdf', 120000, '{}');
  perform t23_set('file_msg', v->>'id');
  -- meta keeps only numbers the chat draws (anything else is dropped)
  v := public.send_message(c, 'image', null, t23_path(c::text, 1, '.jpg'), 'photo.jpg', 'image/jpeg', 90000,
         '{"width": 800, "height": 600, "style": "x", "duration_ms": "1;position:fixed", "waveform": [1, "x"]}');
  if v->'meta' <> '{"width": 800, "height": 600}'::jsonb then
    raise exception 'FAIL: meta not cleaned: %', v->'meta';
  end if;
  v := public.send_message(c, 'video', 'Look', t23_path(c::text, 1, '.mp4'), 'clip.mp4', 'video/mp4', 900000,
         '{"duration_ms": 4000, "waveform": [5, 60, 100]}');
  if v->'meta' <> '{"duration_ms": 4000, "waveform": [5, 60, 100]}'::jsonb then
    raise exception 'FAIL: meta lost good values: %', v->'meta';
  end if;
  raise notice 'PASS: files only from the sender''s own folder of this conversation, once';
end $$;

-- ============================================================ outsiders
select t23_as(4); -- rati is not part of it
do $$
declare c uuid := t23_get('c12')::uuid;
begin
  begin
    perform public.get_conversation(c);
    raise exception 'FAIL: an outsider read the conversation';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if;
  end;
  begin
    perform public.send_message(c, 'text', 'hi');
    raise exception 'FAIL: an outsider wrote into the conversation';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if;
  end;
  begin
    perform public.message_updates(null, c, 0);
    raise exception 'FAIL: an outsider polled the conversation';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if;
  end;
  if (public.message_updates(0)->>'unread')::int <> 0 or jsonb_array_length(public.message_updates(0)->'incoming') <> 0 then
    raise exception 'FAIL: an outsider sees someone else''s messages';
  end if;
  raise notice 'PASS: outsiders can neither read, write nor poll';
end $$;

-- ============================================================ read receipts
select t23_as(2); -- oto
do $$
declare u jsonb; c uuid := t23_get('c12')::uuid; g jsonb; lst jsonb;
begin
  u := public.message_updates(0);
  if (u->>'unread')::int <> 5 or (u->>'unread_conversations')::int <> 1 or jsonb_array_length(u->'incoming') <> 5 then
    raise exception 'FAIL: oto should have 5 unread in 1 conversation: %', u;
  end if;
  if (u->'incoming'->0->'sender'->>'id')::uuid <> u23(1) then
    raise exception 'FAIL: incoming should carry the sender';
  end if;
  lst := public.list_conversations();
  if jsonb_array_length(lst) <> 1 or (lst->0->>'unread')::int <> 5 or lst->0->'last_message'->>'kind' <> 'video' then
    raise exception 'FAIL: inbox %', lst;
  end if;

  g := public.get_conversation(c, null, 3);
  if jsonb_array_length(g->'messages') <> 3 or not (g->>'has_more')::boolean
     or g->'messages'->0->>'kind' <> 'file' or g->'messages'->2->>'kind' <> 'video' then
    raise exception 'FAIL: the newest page, oldest first: %', g->'messages';
  end if;
  g := public.get_conversation(c, (g->'messages'->0->>'seq')::bigint, 3);
  if jsonb_array_length(g->'messages') <> 2 or (g->>'has_more')::boolean then
    raise exception 'FAIL: the older page';
  end if;
  if (g->>'other_read_seq')::bigint < (select max(seq) from public.messages where conversation_id = c) then
    raise exception 'FAIL: the sender has read their own messages';
  end if;

  -- read the first two, then too far ahead (capped), then backwards (ignored)
  perform public.mark_conversation_read(c, (select seq from public.messages where conversation_id = c order by seq offset 1 limit 1));
  if (public.message_updates(null)->>'unread')::int <> 3 then
    raise exception 'FAIL: 3 should be unread after reading 2';
  end if;
  if public.mark_conversation_read(c, 999999999) <> (select max(seq) from public.messages where conversation_id = c) then
    raise exception 'FAIL: reading is capped at the last message';
  end if;
  if public.mark_conversation_read(c, 1) <> (select max(seq) from public.messages where conversation_id = c) then
    raise exception 'FAIL: reading never goes backwards';
  end if;
  if (public.message_updates(null)->>'unread')::int <> 0 then
    raise exception 'FAIL: nothing should be unread';
  end if;
  raise notice 'PASS: unread counts, pages, read receipts';
end $$;

select t23_as(1); -- nia sees that oto read everything
do $$
declare c uuid := t23_get('c12')::uuid; u jsonb;
begin
  u := public.message_updates(null, c, 0);
  if (u->'conversation'->>'other_read_seq')::bigint <> (select max(seq) from public.messages where conversation_id = c) then
    raise exception 'FAIL: nia should see oto read up to the last message';
  end if;
  if jsonb_array_length(u->'conversation'->'changes') <> 5 then
    raise exception 'FAIL: all 5 messages are changes after 0';
  end if;
  if u ? 'incoming' then
    raise exception 'FAIL: no incoming without p_since';
  end if;
  perform t23_set('cursor', (select max(change_seq)::text from public.messages where conversation_id = c));
  raise notice 'PASS: the sender sees the read receipt';
end $$;

-- ============================================================ delete
do $$
declare c uuid := t23_get('c12')::uuid; v jsonb; u jsonb;
begin
  v := public.delete_message(t23_get('file_msg')::uuid);
  if v->>'attachment_path' is null or v->>'attachment_path' not like c::text || '/%' then
    raise exception 'FAIL: delete should return the file to remove: %', v;
  end if;
  if exists (select 1 from public.messages where id = t23_get('file_msg')::uuid
             and (deleted_at is null or body is not null or attachment_path is not null)) then
    raise exception 'FAIL: a deleted message keeps no content';
  end if;
  u := public.message_updates(null, c, t23_get('cursor')::bigint);
  if jsonb_array_length(u->'conversation'->'changes') <> 1
     or u->'conversation'->'changes'->0->>'deleted_at' is null then
    raise exception 'FAIL: the deletion should reach an open chat: %', u->'conversation'->'changes';
  end if;
  if (public.delete_message(t23_get('file_msg')::uuid))->>'attachment_path' is not null then
    raise exception 'FAIL: deleting twice returns no file';
  end if;
  perform set_config('app.current_user_id', u23(2)::text, false);
  begin
    perform public.delete_message(t23_get('m1')::uuid);
    raise exception 'FAIL: oto deleted nia''s message';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if;
  end;
  perform set_config('app.current_user_id', u23(1)::text, false);
  raise notice 'PASS: deleting one''s own message, for both sides';
end $$;

-- ============================================================ incoming / since
select t23_as(2);
do $$
declare c uuid := t23_get('c12')::uuid; since bigint; v jsonb; u jsonb;
begin
  since := (public.message_updates(null)->>'latest_seq')::bigint;
  v := public.send_message(c, 'text', 'Hi Nia');
  perform set_config('app.current_user_id', u23(1)::text, false);
  u := public.message_updates(since);
  if jsonb_array_length(u->'incoming') <> 1 or u->'incoming'->0->>'body' <> 'Hi Nia'
     or u->'incoming'->0->'sender'->>'username' is null then
    raise exception 'FAIL: nia should get exactly the new message: %', u->'incoming';
  end if;
  if (u->>'unread')::int <> 1 then
    raise exception 'FAIL: one unread for nia';
  end if;
  if (u->>'latest_seq')::bigint <> (v->>'seq')::bigint then
    raise exception 'FAIL: latest_seq';
  end if;
  raise notice 'PASS: the poll brings new incoming messages once';
end $$;

-- ============================================================ blocks
select t23_as(2); -- oto blocks nia
select public.block_member(u23(1));
do $$
declare c uuid := t23_get('c12')::uuid;
begin
  begin
    perform public.send_message(c, 'text', 'still there?');
    raise exception 'FAIL: oto writes to someone he blocked';
  exception when others then if sqlerrm not like 'FORBIDDEN: you blocked%' then raise; end if;
  end;
  perform set_config('app.current_user_id', u23(1)::text, false);
  begin
    perform public.send_message(c, 'text', 'hello?');
    raise exception 'FAIL: nia writes to someone who blocked her';
  exception when others then if sqlerrm not like 'FORBIDDEN: this member does not accept%' then raise; end if;
  end;
  begin
    perform public.assert_can_send(c);
    raise exception 'FAIL: an upload would be allowed while blocked';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if;
  end;
  if not (public.get_conversation(c)->>'blocked_me')::boolean then
    raise exception 'FAIL: nia should see she cannot write';
  end if;
  if jsonb_array_length(public.get_conversation(c)->'messages') = 0 then
    raise exception 'FAIL: old messages stay readable';
  end if;
  perform set_config('app.current_user_id', u23(2)::text, false);
  perform public.unblock_member(u23(1));
  perform public.send_message(c, 'text', 'Sorry, unblocked you');
  begin
    perform public.block_member(u23(2));
    raise exception 'FAIL: blocking oneself';
  exception when others then if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
  end;
  raise notice 'PASS: blocking stops writing both ways; unblocking restores it';
end $$;

-- a member who blocked someone doesn't get pop-ups or unread from them
select t23_as(3);
select t23_set('c13', public.start_conversation(u23(1))::text);
select public.send_message(t23_get('c13')::uuid, 'text', 'Buy followers cheap!!!');
select t23_as(1);
do $$
declare before_unread int := (public.message_updates(null)->>'unread')::int;
begin
  perform public.block_member(u23(3));
  if (public.message_updates(null)->>'unread')::int <> before_unread - 1 then
    raise exception 'FAIL: messages from a blocked member are not counted';
  end if;
  if exists (select 1 from jsonb_array_elements(public.message_updates(0)->'incoming') e
             where (e->>'sender_id')::uuid = u23(3)) then
    raise exception 'FAIL: no pop-ups from a blocked member';
  end if;
  if exists (select 1 from jsonb_array_elements(public.list_conversations(null, 50)) e
             where (e->>'id')::uuid = t23_get('c13')::uuid and (e->>'unread')::int <> 0) then
    raise exception 'FAIL: the inbox counts a blocked member''s messages';
  end if;
  raise notice 'PASS: a blocked member''s messages don''t count or pop up';
end $$;

-- writing to a suspended member
select t23_as(4);
select t23_set('c14', public.start_conversation(u23(2))::text);
update public.profiles set status = 'suspended' where id = u23(2);
do $$
begin
  begin
    perform public.send_message(t23_get('c14')::uuid, 'text', 'hi');
    raise exception 'FAIL: wrote to a suspended member';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if;
  end;
  begin
    perform public.start_conversation(u23(2));
    raise exception 'FAIL: started a chat with a suspended member';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if;
  end;
  raise notice 'PASS: suspended members can''t be written to';
end $$;
update public.profiles set status = 'active' where id = u23(2);

-- ============================================================ grants
do $$
begin
  if has_function_privilege('authenticated', 'public.message_json(public.messages)', 'execute')
     or has_function_privilege('authenticated', 'public.member_card(uuid)', 'execute')
     or has_function_privilege('anon', 'public.send_message(uuid, text, text, text, text, text, bigint, jsonb, uuid)', 'execute') then
    raise exception 'FAIL: internal helpers are open to clients';
  end if;
  if not has_function_privilege('authenticated', 'public.message_updates(bigint, uuid, bigint)', 'execute')
     or not has_function_privilege('authenticated', 'public.send_message(uuid, text, text, text, text, text, bigint, jsonb, uuid)', 'execute') then
    raise exception 'FAIL: members cannot use messages';
  end if;
  raise notice 'PASS: function grants';
end $$;

set role authenticated;
do $$
begin
  begin
    perform 1 from public.messages;
    raise exception 'FAIL: messages readable by clients';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.member_blocks;
    raise exception 'FAIL: blocks readable by clients';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: message tables are closed to clients';
end $$;
reset role;

select set_config('app.current_user_id', '', false);
