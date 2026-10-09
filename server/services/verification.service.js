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

//
// Since 020_verification_upgrades.sql it also: stores proof screenshots in
// the private "proofs" Storage bucket and hands them out as short-lived
// signed URLs; runs the 24-hour auto-approval before listing submissions
// (pg_cron runs it too, where available); and drives link-click tasks.
//
// Since 021_trust_and_economy.sql: a proof names the linked account it was
// done from; every screenshot's SHA-256 is recorded so an image can be
// used as proof only once; rejected proofs can be appealed and undone
// actions reported (both go to an admin); reviewers see the member's
// track record, members their waiting-proof limit.

const crypto = require('node:crypto');
const { getClientForUser, supabaseAdmin } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const logger = require('../utils/logger');
const { sniffImage } = require('../utils/images');

const COMPLETION_FIELDS =
  'id, task_id, completer_id, status, reward_amount, created_at, reviewed_at, reviewed_by, ' +
  'campaign_id, platform, task_type, target_url, campaign_creator_id, campaign_title, ' +
  'proof_url, proof_text, submitted_at, review_notes, ' +
  'auto_approved, proof_image_path, link_clicked_at, verification_method, ' +
  'completer_username, completer_display_name, completer_level, account_username, account_url, ' +
  'auto_approve_at, expires_at, appeal_status, undo_report_status';

const PROOF_BUCKET = 'proofs';
const SIGNED_URL_SECONDS = 60 * 60;
// complete_link_click_task() enforces the same wait in the database.
const LINK_CLICK_WAIT_SECONDS = 15;
// Submissions are auto-approved after this long without a review
// (auto_approve_overdue_completions()); the UI shows the countdown.
const AUTO_APPROVE_HOURS = 24;
const AUTO_APPROVE_EVERY_MS = 60 * 1000;

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
// ── screenshots ──────────────────────────────────────────────────────────

// Uploads go through the API (service role) into "<user id>/<random>",
// so a member can only ever reference screenshots in their own folder -
// submit_task_verification() checks that folder against auth.uid().
//
// Each image's SHA-256 goes into proof_images: an image already used as
// proof is refused here, before it is stored, and again - race-proof -
// by submit_task_verification().
async function uploadProofImage(userId, buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Choose an image to upload', 400);
  }
  const kind = sniffImage(buffer);
  if (!kind || kind.type !== contentType) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Screenshots must be JPEG, PNG or WebP images', 400);
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const { data: used, error: lookupError } = await supabaseAdmin
    .from('task_verifications')
    .select('id')
    .eq('proof_image_sha', sha256)
    .limit(1);
  if (lookupError) throw new AppError(ErrorCodes.DB_ERROR, lookupError.message);
  if (Array.isArray(used) && used.length > 0) {
    throw new AppError(ErrorCodes.DUPLICATE_PROOF, 'this screenshot was already used as proof');
  }

  const path = `${userId}/${crypto.randomUUID()}.${kind.ext}`;
  const { error } = await supabaseAdmin.storage
    .from(PROOF_BUCKET)
    .upload(path, buffer, { contentType: kind.type, upsert: false, cacheControl: '3600' });
  if (error) throw new AppError(ErrorCodes.INTERNAL, `proof upload failed: ${error.message}`);

  const { error: recordError } = await supabaseAdmin
    .from('proof_images')
    .insert({ path, user_id: userId, sha256 });
  if (recordError) throw new AppError(ErrorCodes.DB_ERROR, recordError.message);
  return { path };
}

// Signed URLs only for rows the caller could already read (RLS filtered
// them before they got here). An image that can't be signed is left out
// rather than failing the whole list.
async function withImageUrls(rows) {
  const paths = [...new Set(rows.map((r) => r.proof_image_path).filter(Boolean))];
  if (paths.length === 0) return rows;
  const { data, error } = await supabaseAdmin.storage.from(PROOF_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !Array.isArray(data)) {
    logger.warn('proof image signing failed', { message: error?.message });
    return rows;
  }
  const urls = new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => (r.proof_image_path ? { ...r, proof_image_url: urls.get(r.proof_image_path) || null } : r));
}

// ── auto-approval ────────────────────────────────────────────────────────

// At most once a minute per server instance, before submissions are
// listed. Never blocks the list: a failure is only logged.
let lastAutoApproval = 0;
async function runAutoApproval() {
  if (Date.now() - lastAutoApproval < AUTO_APPROVE_EVERY_MS) return;
  lastAutoApproval = Date.now();
  try {
    const { error } = await supabaseAdmin.rpc('auto_approve_overdue_completions');
    if (error) logger.warn('auto-approval failed', { message: error.message });
  } catch (err) {
    logger.warn('auto-approval failed', { message: err.message });
  }
}

// ── submit / review ──────────────────────────────────────────────────────

async function submit(accessToken, taskId, { proof_url, proof_text, proof_image_path, social_profile_id } = {}) {
  const client = getClientForUser(accessToken);

  const { data: completionId, error } = await client.rpc('submit_task_verification', {
    p_task_id: taskId,
    p_proof_url: proof_url || null,
    p_proof_text: proof_text || null,
    p_proof_image_path: proof_image_path || null,
    p_social_profile_id: social_profile_id || null,
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
  const [withUrl] = await withImageUrls([data]);
  return withUrl;
}

// ── link-click tasks ─────────────────────────────────────────────────────

// Step 1: the member opens the link through Exchange. Returns the first
// click's time (opening again never restarts the wait).
async function openLink(accessToken, taskId) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('record_task_link_click', { p_task_id: taskId });
  if (error) throw mapRpcError(error);
  return { clicked_at: data, wait_seconds: LINK_CLICK_WAIT_SECONDS, server_time: new Date().toISOString() };
}

// Step 2: after the wait, the reward is paid at once.
async function completeLink(accessToken, taskId) {
  const client = getClientForUser(accessToken);
  const { data: completionId, error } = await client.rpc('complete_link_click_task', { p_task_id: taskId });
  if (error) throw mapRpcError(error);
  return getCompletionById(accessToken, completionId);
}

// ── appeals and undone actions ───────────────────────────────────────────

// The member asks an admin to look again at a rejected proof (once,
// within 7 days - appeal_rejection() checks).
async function appeal(accessToken, completionId, { message } = {}) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('appeal_rejection', { p_completion_id: completionId, p_message: message });
  if (error) throw mapRpcError(error);
  return getCompletionById(accessToken, completionId);
}

// The creator reports that the member undid the action they were paid for
// (once, within 7 days of the approval - report_unfollow() checks).
async function reportUndone(accessToken, completionId, { message } = {}) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('report_unfollow', { p_completion_id: completionId, p_message: message });
  if (error) throw mapRpcError(error);
  return getCompletionById(accessToken, completionId);
}

// ── track records and limits ─────────────────────────────────────────────

// How each member's earlier proofs went (doer_review_stats()), shown to
// the reviewer. Non-critical: without it the list still loads.
async function doerStats(client, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await client.rpc('doer_review_stats', { p_user_ids: ids });
  if (error || !Array.isArray(data)) return new Map();
  return new Map(data.map((r) => [r.user_id, {
    approved: Number(r.approved) || 0,
    rejected: Number(r.rejected) || 0,
    reversed: Number(r.reversed) || 0,
    trusted: r.trusted !== false,
  }]));
}

// The caller's waiting proofs against their level's limit. Null on error.
async function myLimits(client) {
  const { data, error } = await client.rpc('get_my_proof_limits');
  if (error || !Array.isArray(data) || !data[0]) return null;
  const r = data[0];
  return {
    pending_count: Number(r.pending_count) || 0,
    pending_limit: Number(r.pending_limit) || 0,
    level: Number(r.level) || 1,
    trusted: r.trusted !== false,
  };
}

async function listMine(accessToken, userId, { limit, before, status } = {}) {
  await runAutoApproval();
  const result = await listByColumn(accessToken, 'completer_id', userId, { limit, before, status });
  return { ...result, limits: await myLimits(getClientForUser(accessToken)) };
}

async function listToReview(accessToken, userId, { limit, before, status } = {}) {
  await runAutoApproval();
  const result = await listByColumn(accessToken, 'campaign_creator_id', userId, { limit, before, status });
  const stats = await doerStats(getClientForUser(accessToken), result.completions.map((c) => c.completer_id));
  const completions = result.completions.map((c) => ({ ...c, completer_stats: stats.get(c.completer_id) || null }));
  return { ...result, completions };
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
  if (status && ['pending', 'approved', 'rejected', 'expired', 'reversed'].includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { completions: await withImageUrls(data), next_cursor: nextCursor, auto_approve_hours: AUTO_APPROVE_HOURS };
}

module.exports = {
  submit, review, getCompletionById, listMine, listToReview,
  uploadProofImage, openLink, completeLink, sniffImage,
  appeal, reportUndone, withImageUrls, mapRpcError,
  AUTO_APPROVE_HOURS, LINK_CLICK_WAIT_SECONDS,
};
