// server/services/messages.service.js
// Private messages (023_messages.sql). The rules - who may read or write
// which conversation, blocks, file paths, read receipts - live in the SQL
// functions, called with the member's own token (auth.uid()). This file
// shapes requests and responses, hands out upload URLs, signs file links
// and removes the files of deleted messages.
//
// Files never pass through the API (Vercel caps a request at 4.5 MB): the
// browser uploads them straight to the private "chat" bucket with a
// one-time signed upload URL from createUpload(), then sends the message
// naming that path. They are read through signed URLs; documents get a
// download link that keeps their original name.

const crypto = require('node:crypto');
const { getClientForUser, supabaseAdmin } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const { mapRpcError } = require('./verification.service');
const logger = require('../utils/logger');

const CHAT_BUCKET = 'chat';
const SIGNED_URL_SECONDS = 6 * 60 * 60;

async function rpc(accessToken, fn, args) {
  const { data, error } = await getClientForUser(accessToken).rpc(fn, args);
  if (error) throw mapRpcError(error);
  return data;
}

// ── file links ───────────────────────────────────────────────────────────────

// Adds attachment_url to every message that has a file. A link that can't
// be made is left out (the message still shows, without its file).
async function withUrls(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const media = list.filter((m) => m && m.attachment_path && !m.deleted_at);
  if (media.length === 0) return list;

  const urls = new Map();
  const inline = media.filter((m) => m.kind !== 'file');
  if (inline.length) {
    const { data, error } = await supabaseAdmin.storage
      .from(CHAT_BUCKET)
      .createSignedUrls(inline.map((m) => m.attachment_path), SIGNED_URL_SECONDS);
    if (error) logger.warn('chat file signing failed', { message: error.message });
    for (const item of Array.isArray(data) ? data : []) {
      if (item.signedUrl) urls.set(item.path, item.signedUrl);
    }
  }
  // Documents: a download link under the name they were sent with.
  await Promise.all(media.filter((m) => m.kind === 'file').map(async (m) => {
    const { data, error } = await supabaseAdmin.storage
      .from(CHAT_BUCKET)
      .createSignedUrl(m.attachment_path, SIGNED_URL_SECONDS, { download: m.attachment_name || true });
    if (error) logger.warn('chat file signing failed', { message: error.message });
    else if (data?.signedUrl) urls.set(m.attachment_path, data.signedUrl);
  }));

  return list.map((m) => (m && m.attachment_path ? { ...m, attachment_url: urls.get(m.attachment_path) || null } : m));
}

// ── conversations ────────────────────────────────────────────────────────────

async function listConversations(accessToken, { before, limit } = {}) {
  const validBefore = before && !Number.isNaN(Date.parse(before)) ? String(before) : null;
  const conversations = await rpc(accessToken, 'list_conversations', {
    p_before: validBefore,
    p_limit: Number(limit) || 30,
  });
  return { conversations: Array.isArray(conversations) ? conversations : [] };
}

// The conversation with a member (by id or username), created on first use.
async function startConversation(accessToken, { user_id, username }) {
  let other = user_id || null;
  if (!other && username) {
    const { data, error } = await supabaseAdmin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
    if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Member not found', 404);
    other = data.id;
  }
  const id = await rpc(accessToken, 'start_conversation', { p_other: other });
  return { conversation_id: id };
}

async function getConversation(accessToken, conversationId, { before, limit } = {}) {
  const beforeSeq = Number(before);
  const conversation = await rpc(accessToken, 'get_conversation', {
    p_conversation_id: conversationId,
    p_before_seq: Number.isSafeInteger(beforeSeq) && beforeSeq > 0 ? beforeSeq : null,
    p_limit: Number(limit) || 40,
  });
  conversation.messages = await withUrls(conversation.messages);
  return { conversation };
}

// ── messages ─────────────────────────────────────────────────────────────────

// A path in the sender's own folder of this conversation; the extension is
// kept (lower case, letters and digits) so files open with the right app.
function uploadPath(conversationId, userId, name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  const ext = match ? `.${match[1].toLowerCase()}` : '';
  return `${conversationId}/${userId}/${crypto.randomUUID()}${ext}`;
}

// A one-time URL the browser uploads one file to, straight into Storage.
async function createUpload(accessToken, conversationId, userId, { name }) {
  await rpc(accessToken, 'assert_can_send', { p_conversation_id: conversationId });
  const path = uploadPath(conversationId, userId, name);
  const { data, error } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    throw new AppError(ErrorCodes.INTERNAL, `upload could not be prepared: ${error?.message || 'no URL'}`);
  }
  return { path, upload_url: data.signedUrl };
}

async function send(accessToken, conversationId, body) {
  const attachment = body.attachment || {};
  const message = await rpc(accessToken, 'send_message', {
    p_conversation_id: conversationId,
    p_kind: body.kind,
    p_body: body.body ?? null,
    p_attachment_path: attachment.path ?? null,
    p_attachment_name: attachment.name ?? null,
    p_attachment_type: attachment.type ?? null,
    p_attachment_size: attachment.size ?? null,
    p_meta: body.meta ?? {},
    p_client_id: body.client_id ?? null,
  });
  const [signed] = await withUrls([message]);
  return { message: signed };
}

async function markRead(accessToken, conversationId, seq) {
  const read = await rpc(accessToken, 'mark_conversation_read', {
    p_conversation_id: conversationId,
    p_seq: Number(seq) || 0,
  });
  return { last_read_seq: Number(read) || 0 };
}

// Deletes one's own message for both sides, and its file.
async function remove(accessToken, messageId) {
  const result = await rpc(accessToken, 'delete_message', { p_message_id: messageId });
  const path = result?.attachment_path;
  if (path) {
    const { error } = await supabaseAdmin.storage.from(CHAT_BUCKET).remove([path]);
    if (error) logger.warn('chat file cleanup failed', { message: error.message });
  }
}

// The poll: unread counts, new incoming messages (for the pop-up) and the
// open chat's changes, in one call.
async function updates(accessToken, { since, conversation, after }) {
  const toSeq = (value) => {
    const n = Number(value);
    return value != null && value !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const result = await rpc(accessToken, 'message_updates', {
    p_since: toSeq(since),
    p_conversation_id: conversation || null,
    p_after_change: toSeq(after),
  });
  if (Array.isArray(result.incoming)) {
    // Pop-ups show photos; other files only by name.
    const photos = await withUrls(result.incoming.filter((m) => m.kind === 'image'));
    const byId = new Map(photos.map((m) => [m.id, m]));
    result.incoming = result.incoming.map((m) => byId.get(m.id) || m);
  }
  if (result.conversation) result.conversation.changes = await withUrls(result.conversation.changes);
  return result;
}

async function block(accessToken, userId) {
  await rpc(accessToken, 'block_member', { p_user: userId });
}

async function unblock(accessToken, userId) {
  await rpc(accessToken, 'unblock_member', { p_user: userId });
}

module.exports = {
  listConversations, startConversation, getConversation, createUpload, send, markRead, remove, updates,
  block, unblock, withUrls, uploadPath, CHAT_BUCKET,
};
