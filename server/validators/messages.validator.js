// server/validators/messages.validator.js
// Request bodies for /api/messages. The database checks the same things
// again (send_message()); these give a clear answer before it is asked.

const KINDS = ['text', 'image', 'video', 'audio', 'voice', 'file'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const MAX_BODY = 4000;

function validateStart(body) {
  if (body.user_id != null) return UUID_RE.test(String(body.user_id)) ? [] : ['user_id must be a UUID'];
  if (body.username != null) return USERNAME_RE.test(String(body.username)) ? [] : ['Member not found'];
  return ['Choose who to write to'];
}

function validateSend(body) {
  const errors = [];
  if (!KINDS.includes(body.kind)) errors.push(`kind must be one of: ${KINDS.join(', ')}`);
  if (body.body != null && (typeof body.body !== 'string' || body.body.length > MAX_BODY)) {
    errors.push('A message can be at most 4000 characters');
  }
  if (body.kind === 'text' && !(typeof body.body === 'string' && body.body.trim())) errors.push('Write a message');
  if (body.kind && body.kind !== 'text') {
    const a = body.attachment;
    if (!a || typeof a !== 'object' || typeof a.path !== 'string' || !a.path
        || typeof a.name !== 'string' || !a.name || a.name.length > 255
        || (a.type != null && (typeof a.type !== 'string' || a.type.length > 120))
        || (a.size != null && (!Number.isSafeInteger(a.size) || a.size < 0))) {
      errors.push('Invalid file');
    }
  }
  if (body.meta != null && (typeof body.meta !== 'object' || Array.isArray(body.meta) || JSON.stringify(body.meta).length > 4000)) {
    errors.push('Invalid message details');
  }
  if (body.client_id != null && !UUID_RE.test(String(body.client_id))) errors.push('client_id must be a UUID');
  return errors;
}

function validateUpload(body) {
  const errors = [];
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255) errors.push('Invalid file');
  if (body.type != null && (typeof body.type !== 'string' || body.type.length > 120)) errors.push('Invalid file');
  if (body.size != null && (!Number.isSafeInteger(body.size) || body.size < 0)) errors.push('Invalid file');
  return [...new Set(errors)];
}

function validateRead(body) {
  return Number.isSafeInteger(body.seq) && body.seq >= 0 ? [] : ['seq must be a whole number'];
}

function validateBlock(body) {
  return UUID_RE.test(String(body.user_id || '')) ? [] : ['user_id must be a UUID'];
}

// The poll's ?conversation= (optional).
function validateUpdatesQuery(query) {
  const errors = [];
  if (query.conversation && !UUID_RE.test(String(query.conversation))) errors.push('Invalid conversation: must be a UUID');
  return errors;
}

module.exports = {
  validateStart, validateSend, validateUpload, validateRead, validateBlock, validateUpdatesQuery, KINDS,
};
