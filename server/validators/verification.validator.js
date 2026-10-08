// server/validators/verification.validator.js
// Pure functions: request body in, list of problems out. The database
// functions (submit_task_verification / review_task_verification,
// 015_functions.sql) re-check everything that actually matters for
// authorization and state - this validator only catches malformed input
// early, with a friendlier error than a raw Postgres exception.

const HTTPS_URL_RE = /^https:\/\//;
// "<user uuid>/<uuid>.<ext>" - what POST /api/verification/proof-image
// returns; the database re-checks the folder belongs to the caller.
const PROOF_IMAGE_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MAX_PROOF_TEXT_LEN = 2000;
const MAX_REVIEW_NOTES_LEN = 1000;
const DECISIONS = ['approved', 'rejected'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_MESSAGE_LEN = 10;
const MAX_MESSAGE_LEN = 1000;

function validateSubmit(body) {
  const errors = [];

  const hasUrl = body.proof_url != null && String(body.proof_url).length > 0;
  const hasText = body.proof_text != null && String(body.proof_text).length > 0;
  const hasImage = body.proof_image_path != null && String(body.proof_image_path).length > 0;

  if (!hasUrl && !hasText && !hasImage) {
    errors.push('Add a link, a note or a screenshot as proof');
  }
  if (hasImage && !PROOF_IMAGE_PATH_RE.test(String(body.proof_image_path))) {
    errors.push('Invalid screenshot');
  }
  if (hasUrl && !HTTPS_URL_RE.test(body.proof_url)) {
    errors.push('proof_url must be a valid https:// URL');
  }
  if (hasText && String(body.proof_text).length > MAX_PROOF_TEXT_LEN) {
    errors.push(`proof_text must be ${MAX_PROOF_TEXT_LEN} characters or fewer`);
  }
  if (body.social_profile_id != null && body.social_profile_id !== '' && !UUID_RE.test(String(body.social_profile_id))) {
    errors.push('Choose one of your linked accounts');
  }

  return errors;
}

// An appeal (member) or an undone-action report (creator): a short
// explanation for the admin who decides it.
function validateMessage(body) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < MIN_MESSAGE_LEN) return ['Explain in at least 10 characters'];
  if (message.length > MAX_MESSAGE_LEN) return ['Keep it under 1000 characters'];
  return [];
}

function validateReview(body) {
  const errors = [];

  if (!DECISIONS.includes(body.decision)) {
    errors.push(`decision must be one of: ${DECISIONS.join(', ')}`);
  }
  if (body.review_notes != null && String(body.review_notes).length > MAX_REVIEW_NOTES_LEN) {
    errors.push(`review_notes must be ${MAX_REVIEW_NOTES_LEN} characters or fewer`);
  }
  if (body.decision === 'rejected' && !(body.review_notes && String(body.review_notes).trim().length > 0)) {
    errors.push('review_notes is required when rejecting a submission');
  }

  return errors;
}

module.exports = { validateSubmit, validateReview, validateMessage, PROOF_IMAGE_PATH_RE };
