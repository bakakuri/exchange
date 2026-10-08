// server/services/task.service.js
// Read side of the task marketplace: browsing open tasks and viewing a
// single task's detail. Nothing here writes anything - completing a
// task happens through submit_task_verification() (Stage 8), which
// re-validates everything itself rather than trusting what this file
// returned a moment earlier.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const TASK_PLATFORMS = require('../constants/task-platforms');
const TASK_TYPES = require('../constants/task-types');

const OPEN_TASK_FIELDS =
  'id, campaign_id, platform, task_type, target_url, instructions, verification_method, created_at, ' +
  'creator_id, campaign_title, campaign_description, reward, desired_completions, completed_count, remaining_budget';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// How many proofs each creator approved / rejected by hand
// (creator_review_stats(), 020_verification_upgrades.sql), shown next to
// their tasks so members can judge who actually pays. Non-critical: on
// any error the tasks still load, just without the numbers.
async function creatorStats(client, creatorIds) {
  const ids = [...new Set(creatorIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await client.rpc('creator_review_stats', { p_creator_ids: ids });
  if (error || !Array.isArray(data)) return new Map();
  return new Map(data.map((r) => [r.creator_id, { approved: Number(r.approved) || 0, rejected: Number(r.rejected) || 0 }]));
}

const statsFor = (stats, creatorId) => stats.get(creatorId) || { approved: 0, rejected: 0 };

// public.open_tasks (017_open_tasks_view.sql) already excludes tasks
// whose campaign is paused/completed/cancelled or out of budget/slots -
// the one thing left to filter here is the viewer's own tasks. That's a
// browse-UX choice, not a security boundary: a creator genuinely can't
// complete their own task, but that's enforced independently, in the
// database, the moment they try (submit_task_verification /
// prevent_self_task_completion) - this filter just keeps their own
// listings out of a feed of things to go do.
async function listOpen(accessToken, viewerId, { limit, before, platform, taskType } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('open_tasks')
    .select(OPEN_TASK_FIELDS)
    .neq('creator_id', viewerId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);
  // Bad/unknown filter values are ignored rather than rejected - this is
  // a browse GET, not a form submission, so a stale or hand-edited query
  // string should just behave as "no filter", not error.
  if (platform && TASK_PLATFORMS.includes(platform)) query = query.eq('platform', platform);
  if (taskType && TASK_TYPES.includes(taskType)) query = query.eq('task_type', taskType);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  const stats = await creatorStats(client, data.map((t) => t.creator_id));
  const tasks = data.map((t) => ({ ...t, creator_stats: statsFor(stats, t.creator_id) }));
  return { tasks, next_cursor: nextCursor };
}

// Unlike listOpen, this returns a task regardless of whether its
// campaign is still active - a completer who already submitted proof,
// or the creator managing it, still needs to see it after it closes.
async function getById(accessToken, userId, taskId) {
  const client = getClientForUser(accessToken);

  const { data: task, error } = await client
    .from('tasks')
    .select(
      'id, campaign_id, platform, task_type, target_url, instructions, verification_method, created_at, ' +
      'campaign:campaigns(id, creator_id, title, description, reward, desired_completions, completed_count, remaining_budget, status)'
    )
    .eq('id', taskId)
    .maybeSingle();

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  if (!task) throw new AppError(ErrorCodes.TASK_NOT_FOUND, 'Task not found', 404);

  const { data: myCompletion } = await client
    .from('task_completions')
    .select('id, status, reward_amount, created_at, reviewed_at, auto_approved')
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .maybeSingle();

  const stats = await creatorStats(client, [task.campaign?.creator_id]);
  return { ...task, my_completion: myCompletion || null, creator_stats: statsFor(stats, task.campaign?.creator_id) };
}

module.exports = { listOpen, getById };
