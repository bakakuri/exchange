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

const crypto = require('node:crypto');
const { getClientForUser, supabaseAdmin } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const logger = require('../utils/logger');

const COMPLETION_FIELDS =
  'id, task_id, completer_id, status, reward_amount, created_at, reviewed_at, reviewed_by, ' +
  'campaign_id, platform, task_type, target_url, campaign_creator_id, campaign_title, ' +
  'proof_url, proof_text, submitted_at, review_notes, ' +
  'auto_approved, proof_image_path, link_clicked_at, verification_method';

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

// The file's own first bytes decide what it is; the declared type must agree.
function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', type: 'image/png' };
  }
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

// Uploads go through the API (service role) into "<user id>/<random>",
// so a member can only ever reference screenshots in their own folder -
// submit_task_verification() checks that folder against auth.uid().
async function uploadProofImage(userId, buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Choose an image to upload', 400);
  }
  const kind = sniffImage(buffer);
  if (!kind || kind.type !== contentType) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Screenshots must be JPEG, PNG or WebP images', 400);
  }

  const path = `${userId}/${crypto.randomUUID()}.${kind.ext}`;
  const { error } = await supabaseAdmin.storage
    .from(PROOF_BUCKET)
    .upload(path, buffer, { contentType: kind.type, upsert: false, cacheControl: '3600' });
  if (error) throw new AppError(ErrorCodes.INTERNAL, `proof upload failed: ${error.message}`);
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

async function submit(accessToken, taskId, { proof_url, proof_text, proof_image_path } = {}) {
  const client = getClientForUser(accessToken);

  const { data: completionId, error } = await client.rpc('submit_task_verification', {
    p_task_id: taskId,
    p_proof_url: proof_url || null,
    p_proof_text: proof_text || null,
    p_proof_image_path: proof_image_path || null,
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

async function listMine(accessToken, userId, { limit, before, status } = {}) {
  await runAutoApproval();
  return listByColumn(accessToken, 'completer_id', userId, { limit, before, status });
}

async function listToReview(accessToken, userId, { limit, before, status } = {}) {
  await runAutoApproval();
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
  if (status && ['pending', 'approved', 'rejected', 'expired'].includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { completions: await withImageUrls(data), next_cursor: nextCursor, auto_approve_hours: AUTO_APPROVE_HOURS };
}

module.exports = {
  submit, review, getCompletionById, listMine, listToReview,
  uploadProofImage, openLink, completeLink, sniffImage,
  AUTO_APPROVE_HOURS, LINK_CLICK_WAIT_SECONDS,
};
