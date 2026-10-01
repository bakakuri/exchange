// server/services/notification.service.js
// Reads and mark-as-read for the signed-in user's own notifications.
// Nothing here ever creates a notification - every one is inserted by
// the SECURITY DEFINER functions in 015_functions.sql as a side effect
// of something real happening (a review, a cancellation, a referral
// payout), never by a client request. Marking read is a direct table
// UPDATE, not an RPC: RLS already grants a column-scoped UPDATE(read_at)
// for the caller's own rows (notifications_mark_read_own, 014_rls.sql),
// the same shape as Stage 4/5/9's presentation-field edits.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const NOTIFICATION_FIELDS =
  'id, type, title, body, related_task_id, related_campaign_id, read_at, created_at';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

async function listMine(accessToken, userId, { limit, before, unreadOnly } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('notifications')
    .select(NOTIFICATION_FIELDS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);
  if (unreadOnly) query = query.is('read_at', null);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { notifications: data, next_cursor: nextCursor };
}

async function getUnreadCount(accessToken, userId) {
  const client = getClientForUser(accessToken);

  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  return { unread_count: count || 0 };
}

async function markRead(accessToken, notificationId, userId) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)
    .select(NOTIFICATION_FIELDS)
    .maybeSingle();

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  // RLS matches zero rows for a notification that isn't the caller's own
  // or doesn't exist, rather than raising - same 404-not-403 reasoning
  // as campaign.service.js's getMineById/update.
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Notification not found', 404);
  return data;
}

async function markAllRead(accessToken, userId) {
  const client = getClientForUser(accessToken);

  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
}

module.exports = { listMine, getUnreadCount, markRead, markAllRead };
