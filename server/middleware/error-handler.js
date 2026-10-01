// server/middleware/error-handler.js
// Central error handler. Converts AppError instances into structured JSON
// responses and never leaks stack traces, SQL, or secrets to the client.
// Includes the request ID (set by request-id.js) in every error response
// so a client can quote it in a support report.

const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.requestId || null;

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error(err.message, { code: err.code, requestId });
    }
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
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
