// server/middleware/request-timeout.js
// Aborts requests that exceed TIMEOUT_MS with 503 SERVICE_UNAVAILABLE.
// Prevents runaway DB queries or external-network calls from holding a
// Vercel serverless slot open past the platform's forced-kill window.
//
// Pattern:
//   - A timer is armed when the middleware runs and cleared when the
//     response finishes (res.finish / res.close events).
//   - If the timer fires first, and no response has been sent yet, the
//     error is forwarded to Express's error handler via next(err).
//   - The `done` guard ensures we never call next() after the fact when
//     the response has already been committed by an earlier controller.
//
// Default: 30 s. Override with REQUEST_TIMEOUT_MS env var (milliseconds).
// Vercel Hobby max is 60 s; Pro max is 300 s — 30 s leaves headroom.

'use strict';

const { AppError, ErrorCodes } = require('../utils/errors');
const logger = require('../utils/logger');

const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;

function requestTimeout(req, res, next) {
  // Don't arm a timer if the response has already started (Edge SSE, etc.).
  if (res.headersSent) return next();

  let done = false;

  const timer = setTimeout(() => {
    if (done) return; // response already sent — nothing to do
    done = true;

    logger.warn('Request timed out', {
      timeoutMs: TIMEOUT_MS,
      method: req.method,
      url: req.url,
      requestId: req.requestId || null,
    });

    // If a controller has started writing bytes (streaming), we can no
    // longer send a proper error response — just destroy the socket.
    if (res.headersSent) {
      req.socket && req.socket.destroy();
      return;
    }

    next(new AppError(ErrorCodes.TIMEOUT, 'Request timed out', 503));
  }, TIMEOUT_MS);

  // Disarm on normal completion (finish = headers+body sent; close =
  // connection dropped before or after finish).
  const disarm = () => {
    done = true;
    clearTimeout(timer);
  };
  res.on('finish', disarm);
  res.on('close', disarm);

  next();
}

module.exports = { requestTimeout, TIMEOUT_MS };
