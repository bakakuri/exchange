// server/services/admin.service.js
// Admin-panel data access. All endpoints here are gated by requireAdmin
// middleware, so the caller's admin status has already been confirmed by
// the time any function here runs.
//
// RPC calls (admin_update_user, admin_credit_adjustment) use
// getClientForUser(accessToken) so auth.uid() resolves to the acting
// admin inside each SECURITY DEFINER function - required for audit
// logging and the is_admin() guard inside those functions.
//
// Read-only aggregate queries use supabaseAdmin to bypass RLS for
// efficiency; the route-level requireAdmin gate is the authorisation.

const { supabaseAdmin, getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const PROFILE_FIELDS = require('../constants/profile-fields');
const verificationService = require('./verification.service');
const mediaService = require('./media.service');

const { withImageUrls } = verificationService;

// The proof an appeal or undone-action report is about (021), shown to
// the admin deciding it.
const REPORT_COMPLETION_FIELDS =
  'id, task_id, completer_id, status, reward_amount, created_at, reviewed_at, campaign_id, platform, task_type, ' +
  'target_url, campaign_creator_id, campaign_title, proof_url, proof_text, review_notes, auto_approved, ' +
  'proof_image_path, completer_username, completer_level, account_username, account_url';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const CAMPAIGN_STATUSES = ['active', 'paused', 'completed', 'cancelled'];
const COMPLETION_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'reversed'];

const ADMIN_CAMPAIGN_FIELDS =
  'id, creator_id, title, description, reward, desired_completions, completed_count, ' +
  'total_budget, remaining_budget, reserved_count, status, paused_by_admin, created_at, updated_at, ' +
  'task:tasks(id, platform, task_type, target_url, verification_method)';

// %, _ and \ are wildcards in ilike; a search means the literal text.
function likePattern(search) {
  const term = String(search || '').trim().slice(0, 60);
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// PostgREST's or() filter splits on commas and parentheses, and reads *
// as a wildcard: those become "any character" (_) instead.
function orSafe(pattern) {
  return pattern.replace(/[,()*]/g, '_');
}

// A list cursor is a timestamp; anything else is ignored rather than
// reaching the database.
function validCursor(before) {
  return before && String(before).length <= 40 && !Number.isNaN(Date.parse(before)) ? String(before) : null;
}

function pageOf(rows, pageSize) {
  return rows.length === pageSize ? rows[rows.length - 1].created_at : null;
}

async function profilesById(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', unique);
  return Array.isArray(data) ? Object.fromEntries(data.map((p) => [p.id, p])) : {};
}

// ── error mapping ───────────────────────────────────────────────────────────

function mapRpcError(error) {
  const match = /^([A-Z_]+):\s*(.*)$/.exec(error?.message || '');
  if (match) return new AppError(match[1], match[2]);
  return new AppError(ErrorCodes.VALIDATION_ERROR, error?.message || 'Admin operation failed');
}

// ── user list ───────────────────────────────────────────────────────────────

async function listUsers({ search, limit, before } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  let query = supabaseAdmin
    .from('profiles')
    .select(PROFILE_FIELDS)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (validCursor(before)) query = query.lt('created_at', validCursor(before));

  // Case-insensitive substring search across username and display_name.
  // ilike on two columns with or() is slightly expensive but the table
  // is small and this is an admin-only, low-frequency call.
  const pattern = likePattern(search);
  if (pattern) {
    const safe = orSafe(pattern);
    query = query.or(`username.ilike.${safe},display_name.ilike.${safe}`);
  }

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);

  return {
    users: data,
    next_cursor: data.length === pageSize ? data[data.length - 1].created_at : null,
  };
}

// ── single user ─────────────────────────────────────────────────────────────

async function getUser(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', userId)
    .single();

  if (error || !profile) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  // Quick submission stats so the admin can judge activity at a glance.
  const { count: completionsCount } = await supabaseAdmin
    .from('task_completions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Review status lives on task_completions (task_verifications only holds
  // the proof), so "pending verifications" = this user's pending completions.
  const { count: pendingCount } = await supabaseAdmin
    .from('task_completions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending');

  const [presence, ledger, campaigns, completions, audit] = await Promise.all([
    supabaseAdmin.from('member_presence').select('last_seen_at').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('credit_ledger')
      .select('id, amount, type, description, balance_after, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
    supabaseAdmin.from('campaigns')
      .select('id, title, status, reward, desired_completions, completed_count, created_at')
      .eq('creator_id', userId).order('created_at', { ascending: false }).limit(10),
    supabaseAdmin.from('completion_details')
      .select('id, status, campaign_title, platform, task_type, reward_amount, created_at')
      .eq('completer_id', userId).order('created_at', { ascending: false }).limit(10),
    supabaseAdmin.from('audit_logs')
      .select('id, actor_id, action, reason, created_at')
      .eq('target_id', userId).order('created_at', { ascending: false }).limit(10),
  ]);
  const listOf = (result) => (Array.isArray(result?.data) ? result.data : []);
  const actors = await profilesById(listOf(audit).map((e) => e.actor_id));

  return {
    ...profile,
    // Admins see the real last activity, whatever show_online says.
    last_seen_at: presence?.data?.last_seen_at || null,
    _stats: {
      total_completions: completionsCount ?? 0,
      pending_verifications: pendingCount ?? 0,
    },
    _history: {
      ledger: listOf(ledger),
      campaigns: listOf(campaigns),
      completions: listOf(completions),
      audit: listOf(audit).map((e) => ({ ...e, actor: actors[e.actor_id] || null })),
    },
  };
}

// ── profile moderation (022) ────────────────────────────────────────────────

// Edit or clean up a member's profile; the member is told why. Removed
// photos are deleted from Storage once the profile no longer uses them.
async function updateProfile(accessToken, userId, changes) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('admin_update_profile', {
    p_target_user_id: userId,
    p_username: changes.username ?? null,
    p_display_name: changes.display_name ?? null,
    p_bio: changes.bio ?? null,
    p_category: changes.category ?? null,
    p_remove_avatar: Boolean(changes.remove_avatar),
    p_remove_cover: Boolean(changes.remove_cover),
    p_reason: changes.reason,
  });
  if (error) throw mapRpcError(error);
  await mediaService.deleteFiles([data?.removed_avatar_url, data?.removed_cover_url], userId);
  return getUser(userId);
}

// ── campaigns (022) ─────────────────────────────────────────────────────────

async function listCampaigns({ status, search, before, limit } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  let query = supabaseAdmin
    .from('campaigns')
    .select(ADMIN_CAMPAIGN_FIELDS)
    .order('created_at', { ascending: false })
    .limit(pageSize);
  if (CAMPAIGN_STATUSES.includes(status)) query = query.eq('status', status);
  if (validCursor(before)) query = query.lt('created_at', validCursor(before));
  const pattern = likePattern(search);
  if (pattern) query = query.ilike('title', pattern);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  const creators = await profilesById(data.map((c) => c.creator_id));
  const campaigns = data.map((c) => ({
    ...c,
    task: Array.isArray(c.task) ? c.task[0] || null : c.task || null,
    creator: creators[c.creator_id] || null,
  }));
  return { campaigns, next_cursor: pageOf(data, pageSize) };
}

// pause | resume | cancel, with a reason the creator sees.
async function campaignAction(accessToken, campaignId, action, reason) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('admin_campaign_action', {
    p_campaign_id: campaignId,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw mapRpcError(error);
  const { data } = await supabaseAdmin.from('campaigns').select(ADMIN_CAMPAIGN_FIELDS).eq('id', campaignId).maybeSingle();
  if (!data) return null;
  const creators = await profilesById([data.creator_id]);
  return { ...data, task: Array.isArray(data.task) ? data.task[0] || null : data.task || null, creator: creators[data.creator_id] || null };
}

// ── submissions (022) ───────────────────────────────────────────────────────

const ADMIN_COMPLETION_FIELDS = `${REPORT_COMPLETION_FIELDS}, completer_display_name, auto_approve_at, expires_at, appeal_status, undo_report_status`;

async function listCompletions({ status, search, before, limit } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  let query = supabaseAdmin
    .from('completion_details')
    .select(ADMIN_COMPLETION_FIELDS)
    .order('created_at', { ascending: false })
    .limit(pageSize);
  if (COMPLETION_STATUSES.includes(status)) query = query.eq('status', status);
  if (validCursor(before)) query = query.lt('created_at', validCursor(before));
  const pattern = likePattern(search);
  if (pattern) {
    const safe = orSafe(pattern);
    query = query.or(`campaign_title.ilike.${safe},completer_username.ilike.${safe},account_username.ilike.${safe}`);
  }

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  const creators = await profilesById(data.map((c) => c.campaign_creator_id));
  const completions = (await withImageUrls(data)).map((c) => ({ ...c, creator: creators[c.campaign_creator_id] || null }));
  return { completions, next_cursor: pageOf(data, pageSize) };
}

// Admins may approve or reject any proof; review_task_verification()
// checks the admin role itself.
async function reviewCompletion(accessToken, completionId, { decision, review_notes }) {
  return verificationService.review(accessToken, completionId, { decision, review_notes });
}

// ── messages (022) ──────────────────────────────────────────────────────────

// audience 'everyone' or 'member' (then username names them) - always
// explicit, so a missing username can never turn into a broadcast.
async function sendMessage(accessToken, { audience, username, title, body }) {
  let userId = null;
  if (audience === 'member') {
    const { data, error } = await supabaseAdmin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
    if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'No member with that username', 404);
    userId = data.id;
  }
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('admin_send_message', {
    p_user_id: userId,
    p_title: title,
    p_body: body || '',
  });
  if (error) throw mapRpcError(error);
  return { sent: Number(data) || 0 };
}

async function listMessages({ limit } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('id, actor_id, target_type, target_id, after_data, created_at')
    .eq('action', 'admin.message')
    .order('created_at', { ascending: false })
    .limit(pageSize);
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  const people = await profilesById(data.flatMap((m) => [m.actor_id, m.target_id]));
  return {
    messages: data.map((m) => ({
      id: m.id,
      created_at: m.created_at,
      audience: m.target_type === 'everyone' ? 'everyone' : 'member',
      recipient: people[m.target_id] || null,
      sender: people[m.actor_id] || null,
      title: m.after_data?.title || '',
      body: m.after_data?.body || '',
      recipients: Number(m.after_data?.recipients) || 0,
    })),
  };
}

// ── update user role / status ───────────────────────────────────────────────

async function updateUser(accessToken, userId, { role, status, reason }) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('admin_update_user', {
    p_target_user_id: userId,
    p_new_role: role,
    p_new_status: status,
    p_reason: reason,
  });
  if (error) throw mapRpcError(error);
}

// ── credit adjustment ───────────────────────────────────────────────────────

async function adjustCredits(accessToken, userId, { amount, reason }) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('admin_credit_adjustment', {
    p_target_user_id: userId,
    p_amount: Number(amount),
    p_reason: reason,
  });
  if (error) throw mapRpcError(error);
}

// ── platform stats ──────────────────────────────────────────────────────────

async function getStats() {
  const [
    { count: userCount },
    { count: campaignCount },
    { count: activeCampaignCount },
    { count: pendingVerificationCount },
    { count: pendingReportCount },
    { count: completionCount },
    { count: onlineCount },
    { count: newUserCount },
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('task_completions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabaseAdmin.from('task_completions').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('member_presence').select('*', { count: 'exact', head: true })
      .gt('last_seen_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true })
      .gt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  return {
    total_users: userCount ?? 0,
    total_campaigns: campaignCount ?? 0,
    active_campaigns: activeCampaignCount ?? 0,
    pending_verifications: pendingVerificationCount ?? 0,
    pending_reports: pendingReportCount ?? 0,
    total_completions: completionCount ?? 0,
    online_now: onlineCount ?? 0,
    new_this_week: newUserCount ?? 0,
  };
}

// ── audit log ───────────────────────────────────────────────────────────────

async function listAudit({ limit, before } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  let query = supabaseAdmin
    .from('audit_logs')
    .select('id, actor_id, action, target_type, target_id, before_data, after_data, reason, created_at')
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (validCursor(before)) query = query.lt('created_at', validCursor(before));

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);

  // Enrich each entry with the actor's username for display.
  const actorIds = [...new Set(data.map((e) => e.actor_id).filter(Boolean))];
  let actorMap = {};
  if (actorIds.length) {
    const { data: actors } = await supabaseAdmin
      .from('profiles')
      .select('id, username, display_name')
      .in('id', actorIds);
    if (actors) actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));
  }

  return {
    entries: data.map((e) => ({ ...e, actor: actorMap[e.actor_id] || null })),
    next_cursor: data.length === pageSize ? data[data.length - 1].created_at : null,
  };
}

// ── reports list (admin) ────────────────────────────────────────────────────

async function listReports({ status = 'open', limit, before } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  let query = supabaseAdmin
    .from('reports')
    .select('id, reporter_id, report_type, description, status, related_task_id, related_campaign_id, related_user_id, related_completion_id, resolved_by, resolved_at, created_at')
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (status) query = query.eq('status', status);
  if (validCursor(before)) query = query.lt('created_at', validCursor(before));

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);

  // Enrich: reporter username for display in admin list.
  const reporterIds = [...new Set(data.map((r) => r.reporter_id).filter(Boolean))];
  let reporterMap = {};
  if (reporterIds.length) {
    const { data: reporters } = await supabaseAdmin
      .from('profiles')
      .select('id, username, display_name')
      .in('id', reporterIds);
    if (reporters) reporterMap = Object.fromEntries(reporters.map((p) => [p.id, p]));
  }

  // Enrich: the proof behind an appeal / undone-action report.
  const completionIds = [...new Set(data.map((r) => r.related_completion_id).filter(Boolean))];
  let completionMap = {};
  if (completionIds.length) {
    const { data: completions } = await supabaseAdmin
      .from('completion_details')
      .select(REPORT_COMPLETION_FIELDS)
      .in('id', completionIds);
    if (Array.isArray(completions)) {
      completionMap = Object.fromEntries((await withImageUrls(completions)).map((c) => [c.id, c]));
    }
  }

  const reports = data.map((r) => ({
    ...r,
    reporter: reporterMap[r.reporter_id] || null,
    completion: completionMap[r.related_completion_id] || null,
  }));
  return {
    reports,
    next_cursor: data.length === pageSize ? data[data.length - 1].created_at : null,
  };
}

// ── appeals and undone actions (021) ────────────────────────────────────────

// The rejection was wrong: approve and pay the proof (if its campaign can
// still pay). Closes the appeal.
async function overturnRejection(accessToken, completionId, { note }) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('admin_overturn_rejection', { p_completion_id: completionId, p_note: note || null });
  if (error) throw mapRpcError(error);
}

// The action was undone: take the reward back to the creator. Returns how
// much was taken (less than the reward if the member already spent it).
async function reverseReward(accessToken, completionId, { note }) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('admin_reverse_reward', { p_completion_id: completionId, p_note: note || null });
  if (error) throw mapRpcError(error);
  return { taken_back: Number(data) || 0 };
}

module.exports = {
  listUsers, getUser, updateUser, adjustCredits, getStats, listAudit, listReports,
  overturnRejection, reverseReward,
  updateProfile, listCampaigns, campaignAction, listCompletions, reviewCompletion, sendMessage, listMessages,
  likePattern,
};
