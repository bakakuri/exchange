// server/validators/admin.validator.js
// Validators for admin panel endpoints. Pure functions: return an errors
// array (non-empty = bad request), never throw.

const VALID_ROLES = ['user', 'moderator', 'admin'];
const VALID_STATUSES = ['active', 'suspended'];

function validateUpdateUser(body) {
  const errors = [];
  if (!body.role || !VALID_ROLES.includes(body.role)) {
    errors.push(`role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (!body.reason || String(body.reason).trim().length < 3) {
    errors.push('reason is required (at least 3 characters)');
  }
  return errors;
}

function validateCreditAdjustment(body) {
  const errors = [];
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    errors.push('amount must be a non-zero integer');
  }
  if (!body.reason || String(body.reason).trim().length < 3) {
    errors.push('reason is required (at least 3 characters)');
  }
  return errors;
}

// Deciding an appeal or an undone-action report: an optional note.
function validateDecisionNote(body) {
  if (body.note != null && typeof body.note !== 'string') return ['note must be a string'];
  if (body.note && body.note.length > 1000) return ['note must be at most 1000 characters'];
  return [];
}

// ── 022 ─────────────────────────────────────────────────────────────────────

const { MEMBER_CATEGORIES } = require('../constants/member-categories');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const PROFILE_KEYS = ['username', 'display_name', 'bio', 'category', 'remove_avatar', 'remove_cover', 'reason'];

function reasonProblem(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 3) return 'reason is required (at least 3 characters)';
  if (reason.length > 500) return 'reason must be at most 500 characters';
  return null;
}

// Editing or cleaning up someone's profile. Absent fields stay as they
// are; an empty display name / bio / field clears it.
function validateAdminProfile(body) {
  const errors = [];
  const unknown = Object.keys(body).filter((k) => !PROFILE_KEYS.includes(k));
  if (unknown.length) errors.push(`Unsupported field(s): ${unknown.join(', ')}`);
  if ('username' in body && !USERNAME_RE.test(String(body.username))) {
    errors.push('Username must be 3-30 characters: letters, numbers, underscore only');
  }
  if ('display_name' in body && (typeof body.display_name !== 'string' || body.display_name.length > 60)) {
    errors.push('Display name must be 60 characters or fewer');
  }
  if ('bio' in body && (typeof body.bio !== 'string' || body.bio.length > 500)) {
    errors.push('Bio must be 500 characters or fewer');
  }
  if ('category' in body && body.category !== '' && !MEMBER_CATEGORIES.includes(body.category)) {
    errors.push(`Field of work must be one of: ${MEMBER_CATEGORIES.join(', ')}`);
  }
  for (const key of ['remove_avatar', 'remove_cover']) {
    if (key in body && typeof body[key] !== 'boolean') errors.push(`${key} must be true or false`);
  }
  if (!PROFILE_KEYS.some((k) => k !== 'reason' && k in body)) errors.push('Nothing to change');
  const reason = reasonProblem(body.reason);
  if (reason) errors.push(reason);
  return errors;
}

// Pausing, resuming or cancelling someone's campaign: the creator sees why.
function validateCampaignAction(body) {
  const reason = reasonProblem(body.reason);
  return reason ? [reason] : [];
}

// A message to everyone, or to one member named by username - the
// audience is always explicit.
function validateAdminMessage(body) {
  const errors = [];
  if (body.audience !== 'everyone' && body.audience !== 'member') {
    errors.push('audience must be everyone or member');
  } else if (body.audience === 'member' && !USERNAME_RE.test(String(body.username ?? ''))) {
    errors.push('Username must be 3-30 characters: letters, numbers, underscore only');
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) errors.push('A title is required');
  else if (title.length > 120) errors.push('The title must be at most 120 characters');
  if (body.body != null && (typeof body.body !== 'string' || body.body.length > 2000)) {
    errors.push('The message must be at most 2000 characters');
  }
  return errors;
}

module.exports = {
  validateUpdateUser, validateCreditAdjustment, validateDecisionNote,
  validateAdminProfile, validateCampaignAction, validateAdminMessage,
};
