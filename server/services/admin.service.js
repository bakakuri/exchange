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
const { withImageUrls } = require('./verification.service');

// The proof an appeal or undone-action report is about (021), shown to
// the admin deciding it.
const REPORT_COMPLETION_FIELDS =
  'id, task_id, completer_id, status, reward_amount, created_at, reviewed_at, campaign_id, platform, task_type, ' +
  'target_url, campaign_creator_id, campaign_title, proof_url, proof_text, review_notes, auto_approved, ' +
  'proof_image_path, completer_username, completer_level, account_username, account_url';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

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

  if (before) query = query.lt('created_at', before);

  // Case-insensitive substring search across username and display_name.
  // ilike on two columns with or() is slightly expensive but the table
  // is small and this is an admin-only, low-frequency call.
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    query = query.or(`username.ilike.${term},display_name.ilike.${term}`);
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

  return {
    ...profile,
    _stats: {
      total_completions: completionsCount ?? 0,
      pending_verifications: pendingCount ?? 0,
    },
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
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('task_completions').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabaseAdmin.from('task_completions').select('*', { count: 'exact', head: true }),
  ]);

  return {
    total_users: userCount ?? 0,
    total_campaigns: campaignCount ?? 0,
    active_campaigns: activeCampaignCount ?? 0,
    pending_verifications: pendingVerificationCount ?? 0,
    pending_reports: pendingReportCount ?? 0,
    total_completions: completionCount ?? 0,
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

  if (before) query = query.lt('created_at', before);

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
  if (before) query = query.lt('created_at', before);

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
};
