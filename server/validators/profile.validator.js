// server/validators/profile.validator.js
// Pure functions: request body in, list of problems out. Mirrors the
// same format rules the database enforces (001_profiles.sql) so a bad
// value is rejected with a helpful message here rather than surfacing
// as a raw Postgres constraint error.

const { MEMBER_CATEGORIES } = require('../constants/member-categories');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const LANGUAGE_RE = /^[a-z]{2}$/;

// Exactly the columns 014_rls.sql / 022 grant a user UPDATE on for their
// own row - kept in sync with those migrations deliberately, not derived
// from them, since the two live in different layers of the stack. Photos
// (avatar_url, cover_url) are uploaded through POST /profile/me/avatar|cover
// instead (022 closed the column to members).
const UPDATABLE_FIELDS = ['username', 'display_name', 'bio', 'country', 'language', 'category', 'show_online'];

function validateUpdateProfile(body) {
  const errors = [];
  const keys = Object.keys(body);

  const unknown = keys.filter((key) => !UPDATABLE_FIELDS.includes(key));
  if (unknown.length > 0) errors.push(`Unsupported field(s): ${unknown.join(', ')}`);
  if (keys.length === 0) errors.push('At least one field is required');

  if ('username' in body && !USERNAME_RE.test(body.username)) {
    errors.push('Username must be 3-30 characters: letters, numbers, underscore only');
  }
  if ('display_name' in body && body.display_name !== null && String(body.display_name).length > 60) {
    errors.push('Display name must be 60 characters or fewer');
  }
  if ('bio' in body && body.bio !== null && String(body.bio).length > 500) {
    errors.push('Bio must be 500 characters or fewer');
  }
  if ('category' in body && body.category !== null && !MEMBER_CATEGORIES.includes(body.category)) {
    errors.push(`Field of work must be one of: ${MEMBER_CATEGORIES.join(', ')}`);
  }
  if ('show_online' in body && typeof body.show_online !== 'boolean') {
    errors.push('show_online must be true or false');
  }
  if ('country' in body && body.country !== null && !COUNTRY_RE.test(body.country)) {
    errors.push('Country must be a 2-letter uppercase code (e.g. US, GE)');
  }
  if ('language' in body && body.language !== null && !LANGUAGE_RE.test(body.language)) {
    errors.push('Language must be a 2-letter lowercase code (e.g. en, ka)');
  }

  return errors;
}

module.exports = { validateUpdateProfile, UPDATABLE_FIELDS };
