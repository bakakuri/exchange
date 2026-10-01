// server/services/reports.service.js
// Report submission (user-facing) and admin resolution.
//
// submitReport uses supabaseAdmin + explicit reporter_id because the
// authenticated grant on reports does not include the reporter_id column
// (it must equal auth.uid(), which is enforced by the RLS WITH CHECK when
// using getClientForUser — but that means the column must arrive from somewhere).
// Simplest correct approach: server sets reporter_id = req.user.id using
// supabaseAdmin; caller already verified by requireAuth middleware.
//
// listMine and listOpen use supabaseAdmin with explicit filters to avoid
// leaking rows across users (parallel to admin.service.js read patterns).
// The server is the trust boundary — requireAuth / requireAdmin on the routes
// are the actual authorization gates.

'use strict';

const { supabaseAdmin, getClientForUser } = require('../config/supabase.js');
const { AppError, ErrorCodes } = require('../utils/errors.js');

function mapRpcError(error) {
  const match = /^([A-Z_]+):\s*(.*)$/.exec(error?.message || '');
  if (match) return new AppError(match[1], match[2]);
  return new AppError(ErrorCodes.VALIDATION_ERROR, error?.message || 'Operation failed');
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Submit a new report.
 * reporter_id is set server-side from the authenticated user's id.
 */
async function submitReport(userId, { report_type, description, related_task_id, related_campaign_id, related_user_id }) {
  const payload = {
    reporter_id: userId,
    report_type,
    description: description.trim(),
  };
  if (related_task_id) payload.related_task_id = related_task_id;
  if (related_campaign_id) payload.related_campaign_id = related_campaign_id;
  if (related_user_id) payload.related_user_id = related_user_id;

  const { data, error } = await supabaseAdmin
    .from('reports')
    .insert(payload)
    .select('id, report_type, status, created_at')
    .single();

  if (error) throw new AppError('DB_ERROR', error.message);
  return data;
}

/**
 * List the calling user's own reports, cursor-paginated.
 */
async function listMine(userId, { before, limit: rawLimit } = {}) {
  const limit = Math.min(Number(rawLimit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  let query = supabaseAdmin
    .from('reports')
    .select('id, report_type, description, status, related_task_id, related_campaign_id, related_user_id, resolved_at, created_at')
    .eq('reporter_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new AppError('DB_ERROR', error.message);

  const hasMore = data.length > limit;
  const reports = hasMore ? data.slice(0, limit) : data;
  const cursor = hasMore ? reports[reports.length - 1].created_at : null;
  return { reports, hasMore, cursor };
}

/**
 * Admin: resolve or dismiss a report by calling the SECURITY DEFINER RPC.
 * Uses getClientForUser so auth.uid() inside admin_resolve_report resolves
 * to the acting admin (required for is_admin() check + audit log attribution).
 */
async function resolveReport(accessToken, reportId, { decision, note = '' }) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_decision: decision,
    p_note: note,
  });

  if (error) throw mapRpcError(error);
}

module.exports = { submitReport, listMine, resolveReport };
