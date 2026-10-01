// server/validators/social.validator.js
// Pure functions: request body in, list of problems out.

const PLATFORMS = require('../constants/social-platforms');

const HTTPS_URL_RE = /^https:\/\//;
const MAX_USERNAME_LEN = 100;
const MAX_DISPLAY_NAME_LEN = 100;

// Exactly the columns 014_rls.sql grants a user UPDATE on for their own
// row - platform is deliberately not here: changing which platform a
// link points to isn't an edit, it's a new link (create a new one,
// delete the old).
const UPDATABLE_FIELDS = ['username', 'profile_url', 'display_name'];

function validateCreate(body) {
  const errors = [];

  if (!PLATFORMS.includes(body.platform)) {
    errors.push(`platform must be one of: ${PLATFORMS.join(', ')}`);
  }
  if (!body.username || String(body.username).length === 0 || String(body.username).length > MAX_USERNAME_LEN) {
    errors.push(`username is required (1-${MAX_USERNAME_LEN} characters)`);
  }
  if (!body.profile_url || !HTTPS_URL_RE.test(body.profile_url)) {
    errors.push('profile_url must be a valid https:// URL');
  }
  if (body.display_name != null && String(body.display_name).length > MAX_DISPLAY_NAME_LEN) {
    errors.push(`display_name must be ${MAX_DISPLAY_NAME_LEN} characters or fewer`);
  }

  return errors;
}

function validateUpdate(body) {
  const errors = [];
  const keys = Object.keys(body);

  const unknown = keys.filter((key) => !UPDATABLE_FIELDS.includes(key));
  if (unknown.length > 0) errors.push(`Unsupported field(s): ${unknown.join(', ')}`);
  if (keys.length === 0) errors.push('At least one field is required');

  if ('username' in body && (!body.username || String(body.username).length > MAX_USERNAME_LEN)) {
    errors.push(`username must be 1-${MAX_USERNAME_LEN} characters`);
  }
  if ('profile_url' in body && (!body.profile_url || !HTTPS_URL_RE.test(body.profile_url))) {
    errors.push('profile_url must be a valid https:// URL');
  }
  if ('display_name' in body && body.display_name != null && String(body.display_name).length > MAX_DISPLAY_NAME_LEN) {
    errors.push(`display_name must be ${MAX_DISPLAY_NAME_LEN} characters or fewer`);
  }

  return errors;
}

module.exports = { validateCreate, validateUpdate, UPDATABLE_FIELDS };
