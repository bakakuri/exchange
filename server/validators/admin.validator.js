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

module.exports = { validateUpdateUser, validateCreditAdjustment };
