// server/middleware/admin.js
// Requires requireAuth (middleware/auth.js) to have already run. role is
// read from the database-backed req.user, never from anything the
// client could set directly - the frontend's notion of "am I an admin"
// is presentation only and is never trusted here.

const { AppError, ErrorCodes } = require('../utils/errors');

function requireAdmin(req, res, next) {
  if (!req.user) {
    return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Sign in required', 401));
  }
  if (req.user.role !== 'admin') {
    return next(new AppError(ErrorCodes.FORBIDDEN, 'Admin privileges required', 403));
  }
  next();
}

module.exports = { requireAdmin };
