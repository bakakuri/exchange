// server/services/credit.service.js
// Read-only access to the credit economy for the signed-in user. Every
// balance change happens inside other domains' SECURITY DEFINER
// functions (campaign reservation/refund, task rewards, referrals,
// admin adjustments - see 015_functions.sql) via write_ledger_entry,
// which has no client EXECUTE grant at all - nothing in this file, or
// reachable from the API before Stage 14's admin endpoints, ever writes
// a ledger row directly.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const LEDGER_FIELDS = 'id, amount, type, description, balance_after, related_task_id, related_campaign_id, created_at';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Cursor-based (created_at) rather than offset pagination: the ledger is
// append-only and can grow without bound, and a cursor doesn't skip or
// repeat rows when new entries land between page requests the way an
// offset would.
async function getLedger(accessToken, userId, { limit, before } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('credit_ledger')
    .select(LEDGER_FIELDS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { entries: data, next_cursor: nextCursor };
}

// Per-transaction-type totals (Stage 10 - the reward engine's output,
// not the mechanics: get_credit_summary() does the aggregation itself,
// 019_credit_summary_function.sql, since PostgREST/supabase-js has no
// GROUP BY of its own). Not security definer - it relies on the same
// authenticated grant and credit_ledger_select_own RLS policy this
// file's getLedger() already uses, so the RPC call goes through the
// caller's own access token same as every other call in this codebase.
async function getSummary(accessToken) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client.rpc('get_credit_summary');
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  return { by_type: data };
}

// Progress toward the one-time welcome bonus (get_starter_bonus(),
// 021_trust_and_economy.sql): approvals by different creators so far.
async function getWelcomeBonus(accessToken) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('get_starter_bonus');
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    creators_done: Number(row?.creators_done) || 0,
    creators_needed: Number(row?.creators_needed) || 3,
    amount: Number(row?.amount) || 10,
    granted_at: row?.granted_at || null,
  };
}

module.exports = { getLedger, getSummary, getWelcomeBonus };
