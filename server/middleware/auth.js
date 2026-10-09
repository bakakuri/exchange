// server/middleware/auth.js
// Verifies the Authorization: Bearer <token> header against Supabase and
// attaches the resulting profile (id, email, username, role, status) to
// req.user. This is the ONE place a request's identity is established;
// every protected route depends on it running first, and nothing here
// ever trusts a client-supplied role or user id.

const { AppError, ErrorCodes } = require('../utils/errors');
const { asyncHandler } = require('../utils/async-handler');
const authService = require('../services/auth.service');
const presenceService = require('../services/presence.service');

function extractToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Sign in required', 401));
  }

  const user = await authService.getUserFromToken(token);
  if (!user) {
    return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired session', 401));
  }

  if (user.status !== 'active') {
    return next(new AppError(ErrorCodes.FORBIDDEN, 'Account is suspended', 403));
  }

  req.user = user;
  req.accessToken = token;
  // "Online" / "last seen" (022): at most one write a minute, never fails.
  await presenceService.touch(user.id);
  next();
});

// Like requireAuth, but does not fail when there is no token - for
// routes that behave differently for signed-in vs anonymous callers
// without requiring a session (e.g. browsing tasks).
const attachUserIfPresent = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  const user = await authService.getUserFromToken(token);
  if (user && user.status === 'active') {
    req.user = user;
    req.accessToken = token;
    await presenceService.touch(user.id);
  }
  next();
});

module.exports = { requireAuth, attachUserIfPresent };
