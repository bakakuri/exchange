// server/middleware/rate-limit.js
// General API limiter plus a factory for stricter, route-specific limiters
// (login, registration, verification submission, etc. added in later
// stages). One authoritative rate-limiting mechanism, reused everywhere.

const rateLimit = require('express-rate-limit');
const { config } = require('../config/env');

const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
});

function createRateLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: message || 'Too many requests.' } },
  });
}

module.exports = { generalLimiter, createRateLimiter };
