// server/validators/auth.validator.js
// Pure functions: request body in, list of problems out. No side
// effects and no database access - just format checks that happen
// before anything touches Supabase.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

function validateRegister(body) {
  const errors = [];
  if (!body.email || !EMAIL_RE.test(body.email)) errors.push('A valid email is required');
  if (!body.password || String(body.password).length < 8) errors.push('Password must be at least 8 characters');
  if (body.username && !USERNAME_RE.test(body.username)) {
    errors.push('Username must be 3-30 characters: letters, numbers, underscore only');
  }
  if (body.referral_code && typeof body.referral_code !== 'string') {
    errors.push('referral_code must be a string');
  }
  return errors;
}

function validateLogin(body) {
  const errors = [];
  if (!body.email || !EMAIL_RE.test(body.email)) errors.push('A valid email is required');
  if (!body.password) errors.push('Password is required');
  return errors;
}

function validatePasswordResetRequest(body) {
  const errors = [];
  if (!body.email || !EMAIL_RE.test(body.email)) errors.push('A valid email is required');
  return errors;
}

function validatePasswordResetConfirm(body) {
  const errors = [];
  if (!body.access_token) errors.push('Reset token is required');
  if (!body.password || String(body.password).length < 8) errors.push('Password must be at least 8 characters');
  return errors;
}

function validateRefresh(body) {
  const errors = [];
  if (!body.refresh_token) errors.push('refresh_token is required');
  return errors;
}

module.exports = {
  validateRegister,
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordResetConfirm,
  validateRefresh,
};
