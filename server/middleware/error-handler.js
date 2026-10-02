// server/middleware/error-handler.js
// Central error handler. Converts AppError instances into structured JSON
// responses and never leaks stack traces, SQL, or secrets to the client.
// Includes the request ID (set by request-id.js) in every error response
// so a client can quote it in a support report.

const { AppError, ErrorCodes } = require('../utils/errors');
const logger = require('../utils/logger');

// 5xx AppErrors often wrap a raw database message (DB_ERROR) - log it,
// but send the client a generic message. TIMEOUT's text is already safe.
const SAFE_5XX_CODES = new Set([ErrorCodes.TIMEOUT]);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.requestId || null;

  if (err instanceof AppError) {
    const isServerError = err.status >= 500;
    if (isServerError) {
      logger.error(err.message, { code: err.code, requestId });
    }
    const message = isServerError && !SAFE_5XX_CODES.has(err.code)
      ? 'Something went wrong.'
      : err.message;
    return res.status(err.status).json({
      error: { code: err.code || ErrorCodes.INTERNAL, message },
      requestId,
    });
  }

  logger.error(err.stack || err.message, { requestId });
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    requestId,
  });
}

module.exports = { errorHandler };
