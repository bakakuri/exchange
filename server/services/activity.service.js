// server/services/activity.service.js
// Read-only feed of what a user has done - profile timelines and
// dashboards, never a source of truth for credits (that's
// credit_ledger, server/services/credit.service.js). activity_select_all
// (014_rls.sql) makes every row visible to any authenticated caller, so
// unlike notifications there is no "owner" scoping to enforce here; this
// file only knows "list activity for a user id" - resolving a username
// to that id is profile.service.js's job (see
// profile.controller.js's getSocialByUsername for the same composition).

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const ACTIVITY_FIELDS = 'id, type, related_task_id, related_campaign_id, metadata, created_at';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

async function listForUser(accessToken, userId, { limit, before } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('activity')
    .select(ACTIVITY_FIELDS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { activity: data, next_cursor: nextCursor };
}

module.exports = { listForUser };
