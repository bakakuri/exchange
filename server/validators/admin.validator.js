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

module.exports = { validateUpdateUser, validateCreditAdjustment, validateDecisionNote };
