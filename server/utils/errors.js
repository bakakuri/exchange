// server/utils/errors.js
// Canonical business error codes and the AppError class used to raise them.
// One authoritative list: services throw these, the error handler maps
// them to HTTP responses, nothing else invents ad-hoc error shapes.

const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_NOT_AVAILABLE: 'TASK_NOT_AVAILABLE',
  TASK_ALREADY_COMPLETED: 'TASK_ALREADY_COMPLETED',
  SELF_TASK_FORBIDDEN: 'SELF_TASK_FORBIDDEN',

  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  INSUFFICIENT_BUDGET: 'INSUFFICIENT_BUDGET',

  VERIFICATION_PENDING: 'VERIFICATION_PENDING',
  VERIFICATION_ALREADY_REVIEWED: 'VERIFICATION_ALREADY_REVIEWED',

  CAMPAIGN_NOT_ACTIVE: 'CAMPAIGN_NOT_ACTIVE',
  CAMPAIGN_COMPLETED: 'CAMPAIGN_COMPLETED',
  CAMPAIGN_CANCELLED: 'CAMPAIGN_CANCELLED',

  TIMEOUT: 'TIMEOUT',               // 503 — request took too long to process
  INTERNAL: 'INTERNAL',             // 500 — unexpected server error
  DB_ERROR: 'DB_ERROR',             // 500 — a database query failed (details logged, never sent)
};

const STATUS_BY_CODE = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,

  TASK_NOT_FOUND: 404,
  TASK_NOT_AVAILABLE: 409,
  TASK_ALREADY_COMPLETED: 409,
  SELF_TASK_FORBIDDEN: 403,

  INSUFFICIENT_CREDITS: 402,
  INSUFFICIENT_BUDGET: 409,

  VERIFICATION_PENDING: 409,
  VERIFICATION_ALREADY_REVIEWED: 409,

  CAMPAIGN_NOT_ACTIVE: 409,
  CAMPAIGN_COMPLETED: 409,
  CAMPAIGN_CANCELLED: 409,

  TIMEOUT: 503,
  INTERNAL: 500,
  DB_ERROR: 500,
};

class AppError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status || STATUS_BY_CODE[code] || 500;
  }
}

module.exports = { AppError, ErrorCodes };
