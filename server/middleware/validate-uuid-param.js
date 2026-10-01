// server/middleware/validate-uuid-param.js
// Middleware factory that validates a named URL parameter is a well-formed
// UUID v4 (or any canonical UUID — the regex accepts v1–v5 and the nil
// UUID, matching the format Supabase/PostgreSQL expects).
//
// Usage (in a route file):
//   const { validateUuidParam } = require('../middleware/validate-uuid-param');
//   router.get('/:id', validateUuidParam('id'), controller.getById);
//
// Returns 400 VALIDATION_ERROR if the value doesn't look like a UUID, so
// the database never receives a malformed id (which would be a type error
// at the Postgres layer anyway, but this gives a cleaner client message and
// prevents the round-trip).

const { AppError, ErrorCodes } = require('../utils/errors');

// Matches the canonical 8-4-4-4-12 hex UUID format (case-insensitive).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuidParam(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (!value || !UUID_RE.test(value)) {
      return next(
        new AppError(
          ErrorCodes.VALIDATION_ERROR,
          `Invalid ${paramName}: must be a UUID`,
          400
        )
      );
    }
    next();
  };
}

module.exports = { validateUuidParam };
