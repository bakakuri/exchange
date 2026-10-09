// server/services/campaign.service.js
// The creator's side of the marketplace: create a campaign (spending
// credits), manage its presentation, pause/resume/cancel it. Every
// economic or state-machine change - creating, pausing, resuming,
// cancelling - goes through the SECURITY DEFINER functions in
// 015_functions.sql via RPC, through the caller's own access token, so
// auth.uid() inside them resolves to the real caller and re-checks
// ownership itself rather than trusting anything this file decided.
// Presentation fields (title/description) are the one exception: RLS
// (campaigns_update_own_presentation, 014_rls.sql) already grants a
// direct column-scoped UPDATE for those, so there's no function for it,
// same pattern as Stage 4/5's profile and social-profile edits.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const CAMPAIGN_FIELDS =
  'id, creator_id, title, description, reward, desired_completions, completed_count, ' +
  'total_budget, remaining_budget, reserved_count, status, paused_by_admin, created_at, updated_at, ' +
  'task:tasks(id, platform, task_type, target_url, instructions, verification_method)';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// tasks:tasks(...) embeds as an array in PostgREST even though the
// unique(campaign_id) constraint makes it 1:1 in practice (004_tasks.sql)
// - flatten it to a single object (or null, for the moment between a
// campaign existing and its one task being inserted, which never
// actually happens here since create_campaign() creates both together,
// but is worth not crashing on).
function flattenTask(row) {
  if (!row) return row;
  const task = Array.isArray(row.task) ? row.task[0] || null : row.task || null;
  return { ...row, task };
}

async function create(accessToken, body) {
  const client = getClientForUser(accessToken);

  const { data: campaignId, error } = await client.rpc('create_campaign', {
    p_title: body.title.trim(),
    p_description: body.description || '',
    p_platform: body.platform,
    p_task_type: body.task_type,
    p_target_url: body.target_url,
    p_instructions: body.instructions || '',
    p_verification_method: body.verification_method || 'manual_proof',
    p_reward: Number(body.reward),
    p_desired_completions: Number(body.desired_completions),
  });

  if (error) throw mapRpcError(error);
  // campaigns_select_all (014_rls.sql) already lets any authenticated
  // caller read any campaign, so the unscoped read is enough here - no
  // need to re-derive the creator_id ownership check getMineById exists
  // for, immediately after the RPC that just created this campaign as
  // this same caller.
  return getById(accessToken, campaignId);
}

async function listMine(accessToken, userId, { limit, before, status } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('campaigns')
    .select(CAMPAIGN_FIELDS)
    .eq('creator_id', userId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);
  if (status && ['active', 'paused', 'completed', 'cancelled'].includes(status)) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const campaigns = data.map(flattenTask);
  const nextCursor = campaigns.length === pageSize ? campaigns[campaigns.length - 1].created_at : null;
  return { campaigns, next_cursor: nextCursor };
}

// Scoped to the caller's own campaigns - not an RLS boundary (campaigns
// are publicly readable, campaigns_select_all in 014_rls.sql, since
// GET /api/tasks/:id already exposes a campaign's public-facing fields
// through its task), just this endpoint's purpose: the creator's
// management view of a campaign they own. A campaign that exists but
// isn't the caller's own is reported as NOT_FOUND rather than FORBIDDEN,
// so this endpoint doesn't confirm campaign ids belong to other people.
async function getMineById(accessToken, campaignId, userId) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client
    .from('campaigns')
    .select(CAMPAIGN_FIELDS)
    .eq('id', campaignId)
    .eq('creator_id', userId)
    .maybeSingle();

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Campaign not found', 404);
  return flattenTask(data);
}

// Unscoped read used only right after create() confirms the id, and as
// a fallback if that owner-scoped read races with replication lag in a
// real Supabase project - reads whatever campaigns_select_all already
// allows anyone to see.
async function getById(accessToken, campaignId) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client.from('campaigns').select(CAMPAIGN_FIELDS).eq('id', campaignId).maybeSingle();

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Campaign not found', 404);
  return flattenTask(data);
}

async function update(accessToken, campaignId, patch) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client
    .from('campaigns')
    .update(patch)
    .eq('id', campaignId)
    .select(CAMPAIGN_FIELDS)
    .maybeSingle();

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  // RLS (campaigns_update_own_presentation) silently matches zero rows
  // for a campaign that isn't the caller's own or doesn't exist, rather
  // than raising - same 404-not-403 reasoning as getMineById above.
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Campaign not found', 404);
  return flattenTask(data);
}

async function setPauseState(accessToken, campaignId, paused) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('set_campaign_pause_state', { p_campaign_id: campaignId, p_paused: paused });
  if (error) throw mapRpcError(error);
  return getById(accessToken, campaignId);
}

async function cancel(accessToken, campaignId, reason) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('cancel_campaign', { p_campaign_id: campaignId, p_reason: reason || null });
  if (error) throw mapRpcError(error);
  return getById(accessToken, campaignId);
}

// Same convention as verification.service.js: Postgres functions here
// raise 'CODE: human message' with errcode P0001 (015_functions.sql),
// parsed back into this codebase's AppError/ErrorCodes.
const RPC_ERROR_RE = /^([A-Z_]+):\s*(.*)$/;

function mapRpcError(error) {
  const match = RPC_ERROR_RE.exec(error.message || '');
  if (match) {
    // cancel_campaign()/reward_task_completion() raise 'CAMPAIGN_<STATUS>:
    // ...' dynamically (e.g. CAMPAIGN_COMPLETED, CAMPAIGN_CANCELLED) -
    // those match ErrorCodes directly. Anything else unrecognized falls
    // back to VALIDATION_ERROR rather than leaking a raw code.
    if (ErrorCodes[match[1]]) return new AppError(match[1], match[2]);
  }
  return new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
}

module.exports = { create, listMine, getMineById, getById, update, setPauseState, cancel };
