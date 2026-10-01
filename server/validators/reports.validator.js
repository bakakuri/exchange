// server/validators/reports.validator.js
// Input validation for user-submitted reports and admin resolution.

'use strict';

const VALID_TYPES = [
  'spam',
  'fraud',
  'invalid_task',
  'inappropriate_content',
  'broken_url',
  'abuse',
];

const VALID_DECISIONS = ['resolved', 'dismissed'];

/**
 * Validate a user-submitted report.
 * At least one related_* id is required alongside report_type + description.
 */
function validateSubmitReport(body) {
  const errors = [];
  const { report_type, description, related_task_id, related_campaign_id, related_user_id } = body;

  if (!report_type || !VALID_TYPES.includes(report_type)) {
    errors.push(`report_type must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    errors.push('description must be at least 10 characters');
  }

  if (description && description.trim().length > 2000) {
    errors.push('description must be at most 2000 characters');
  }

  const hasTarget = related_task_id || related_campaign_id || related_user_id;
  if (!hasTarget) {
    errors.push('at least one of related_task_id, related_campaign_id, or related_user_id is required');
  }

  // UUID format check for any supplied related id.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [key, val] of Object.entries({ related_task_id, related_campaign_id, related_user_id })) {
    if (val !== undefined && val !== null && !UUID_RE.test(val)) {
      errors.push(`${key} must be a valid UUID`);
    }
  }

  return errors;
}

/**
 * Validate an admin resolution payload.
 * decision: 'resolved' | 'dismissed'
 * note: optional free-text (admin's reasoning, logged to audit trail)
 */
function validateResolveReport(body) {
  const errors = [];
  const { decision, note } = body;

  if (!decision || !VALID_DECISIONS.includes(decision)) {
    errors.push(`decision must be one of: ${VALID_DECISIONS.join(', ')}`);
  }

  if (note !== undefined && typeof note !== 'string') {
    errors.push('note must be a string');
  }

  if (note && note.length > 1000) {
    errors.push('note must be at most 1000 characters');
  }

  return errors;
}

module.exports = { validateSubmitReport, validateResolveReport, VALID_TYPES };
