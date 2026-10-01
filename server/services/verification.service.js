// server/services/verification.service.js
// Submitting proof of completion and reviewing it. The actual
// authorization and state-machine rules (self-task, duplicate
// submission, campaign still payable, only the campaign owner/admin can
// review, no re-reviewing) all live in submit_task_verification() and
// review_task_verification() (015_functions.sql) - this file's job is
// to call those RPCs with the caller's own access token (so auth.uid()
// inside them resolves to the real caller, never a value this file
// supplies), translate their structured 'CODE: message' exceptions into
// the same AppError/ErrorCodes every other service uses, and read back
// through public.completion_details (018_completion_details_view.sql)
// for the "my submissions" / "to review" lists, which RLS narrows to
// exactly what each caller is allowed to see.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const COMPLETION_FIELDS =
  'id, task_id, completer_id, status, reward_amount, created_at, reviewed_at, reviewed_by, ' +
  'campaign_id, platform, task_type, target_url, campaign_creator_id, campaign_title, ' +
  'proof_url, proof_text, submitted_at, review_notes';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Postgres functions in this codebase raise 'CODE: human message' with
// errcode P0001 (see 015_functions.sql's own comments on this
// convention). supabase-js surfaces that as error.message, prefixed
// with the code exactly as raised - parse it back out and map it onto
// the canonical ErrorCodes every controller already expects, falling
// back to a generic VALIDATION_ERROR for anything that doesn't match
// rather than leaking a raw Postgres message untranslated.
const RPC_ERROR_RE = /^([A-Z_]+):\s*(.*)$/;

function mapRpcError(error) {
  const match = RPC_ERROR_RE.exec(error.message || '');
  if (match && ErrorCodes[match[1]]) {
    return new AppError(match[1], match[2]);
  }
  return new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
}

// userId isn't sent to the RPC - the function resolves the actor from
// auth.uid() itself, internally, using the JWT the access token carries.
// It's only used here to shape the client-facing response.
async function submit(accessToken, taskId, { proof_url, proof_text } = {}) {
  const client = getClientForUser(accessToken);

  const { data: completionId, error } = await client.rpc('submit_task_verification', {
    p_task_id: taskId,
    p_proof_url: proof_url || null,
    p_proof_text: proof_text || null,
  });

  if (error) throw mapRpcError(error);
  return getCompletionById(accessToken, completionId);
}

async function review(accessToken, completionId, { decision, review_notes } = {}) {
  const client = getClientForUser(accessToken);

  const { error } = await client.rpc('review_task_verification', {
    p_completion_id: completionId,
    p_decision: decision,
    p_review_notes: review_notes || null,
  });

  if (error) throw mapRpcError(error);
  return getCompletionById(accessToken, completionId);
}

async function getCompletionById(accessToken, completionId) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client
    .from('completion_details')
    .select(COMPLETION_FIELDS)
    .eq('id', completionId)
    .maybeSingle();

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  // RLS (task_completions_select_participant, applied through the view
  // via security_invoker - see 018_completion_details_view.sql) already
  // hides rows the caller isn't a participant in; a missing row here is
  // indistinguishable from "doesn't exist" to anyone who shouldn't know
  // the difference, which is exactly the right behavior for a 404.
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Completion not found', 404);
  return data;
}

async function listMine(accessToken, userId, { limit, before, status } = {}) {
  return listByColumn(accessToken, 'completer_id', userId, { limit, before, status });
}

async function listToReview(accessToken, userId, { limit, before, status } = {}) {
  return listByColumn(accessToken, 'campaign_creator_id', userId, { limit, before, status });
}

async function listByColumn(accessToken, column, value, { limit, before, status }) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('completion_details')
    .select(COMPLETION_FIELDS)
    .eq(column, value)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);
  if (status && ['pending', 'approved', 'rejected'].includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { completions: data, next_cursor: nextCursor };
}

module.exports = { submit, review, getCompletionById, listMine, listToReview };
