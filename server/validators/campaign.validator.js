// server/validators/campaign.validator.js
// Pure functions: request body in, list of problems out. Mirrors the
// checks create_campaign()/the campaigns+tasks table constraints already
// enforce (015_functions.sql, 003_campaigns.sql, 004_tasks.sql), so a bad
// value is rejected with a helpful message here rather than surfacing as
// a raw Postgres exception - the database re-checks everything itself
// regardless of what passes here.

const TASK_PLATFORMS = require('../constants/task-platforms');
const TASK_TYPES = require('../constants/task-types');
const VERIFICATION_METHODS = require('../constants/verification-methods');

// Matches the target_url_format constraint in 004_tasks.sql exactly
// (http:// allowed, not just https://) - deliberately not the stricter
// HTTPS_URL_RE other validators use for profile/social links, since this
// mirrors a different constraint than those do.
const URL_RE = /^https?:\/\//;

const LINK_CLICK_TASK_TYPES = ['visit', 'view', 'listen'];

const MAX_TITLE_LEN = 120;
const MAX_DESCRIPTION_LEN = 2000;
const MAX_INSTRUCTIONS_LEN = 1000;
const MAX_REWARD = 100000;
const MAX_DESIRED_COMPLETIONS = 100000;

function validateCreate(body) {
  const errors = [];

  if (!body.title || String(body.title).trim().length === 0 || String(body.title).length > MAX_TITLE_LEN) {
    errors.push(`title is required (1-${MAX_TITLE_LEN} characters)`);
  }
  if (body.description != null && String(body.description).length > MAX_DESCRIPTION_LEN) {
    errors.push(`description must be ${MAX_DESCRIPTION_LEN} characters or fewer`);
  }
  if (!TASK_PLATFORMS.includes(body.platform)) {
    errors.push(`platform must be one of: ${TASK_PLATFORMS.join(', ')}`);
  }
  if (!TASK_TYPES.includes(body.task_type)) {
    errors.push(`task_type must be one of: ${TASK_TYPES.join(', ')}`);
  }
  if (!body.target_url || !URL_RE.test(body.target_url)) {
    errors.push('target_url must be a valid http:// or https:// URL');
  }
  if (body.instructions != null && String(body.instructions).length > MAX_INSTRUCTIONS_LEN) {
    errors.push(`instructions must be ${MAX_INSTRUCTIONS_LEN} characters or fewer`);
  }
  if (body.verification_method != null && !VERIFICATION_METHODS.includes(body.verification_method)) {
    errors.push(`verification_method must be one of: ${VERIFICATION_METHODS.join(', ')}`);
  }
  // A click proves a visit, never a follow or a like (link_click_task_types,
  // 020_verification_upgrades.sql).
  if (body.verification_method === 'link_click' && !LINK_CLICK_TASK_TYPES.includes(body.task_type)) {
    errors.push('Link-click checking is only for Visit, View and Listen tasks');
  }

  const reward = Number(body.reward);
  if (!Number.isInteger(reward) || reward <= 0 || reward > MAX_REWARD) {
    errors.push(`reward must be a whole number between 1 and ${MAX_REWARD}`);
  }

  const desiredCompletions = Number(body.desired_completions);
  if (!Number.isInteger(desiredCompletions) || desiredCompletions <= 0 || desiredCompletions > MAX_DESIRED_COMPLETIONS) {
    errors.push(`desired_completions must be a whole number between 1 and ${MAX_DESIRED_COMPLETIONS}`);
  }

  return errors;
}

// Exactly the columns 014_rls.sql grants a user UPDATE on for their own
// campaign - everything else with economic or state-machine consequences
// (reward, status, budget) only ever changes through the RPCs.
const UPDATABLE_FIELDS = ['title', 'description'];

function validateUpdate(body) {
  const errors = [];
  const keys = Object.keys(body);

  const unknown = keys.filter((key) => !UPDATABLE_FIELDS.includes(key));
  if (unknown.length > 0) errors.push(`Unsupported field(s): ${unknown.join(', ')}`);
  if (keys.length === 0) errors.push('At least one field is required');

  if ('title' in body && (!body.title || String(body.title).trim().length === 0 || String(body.title).length > MAX_TITLE_LEN)) {
    errors.push(`title must be 1-${MAX_TITLE_LEN} characters`);
  }
  if ('description' in body && body.description != null && String(body.description).length > MAX_DESCRIPTION_LEN) {
    errors.push(`description must be ${MAX_DESCRIPTION_LEN} characters or fewer`);
  }

  return errors;
}

function validateCancel(body) {
  const errors = [];
  if (body.reason != null && String(body.reason).length > 500) {
    errors.push('reason must be 500 characters or fewer');
  }
  return errors;
}

module.exports = { validateCreate, validateUpdate, validateCancel, UPDATABLE_FIELDS };
