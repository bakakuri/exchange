// server/middleware/require-json.js
// Enforces Content-Type: application/json for requests that carry a body
// (POST, PUT, PATCH). Without this a client that sends form-encoded or
// plain-text data would bypass the validator (express.json() silently
// leaves req.body undefined, validators then treat it as an empty object,
// and required fields appear missing rather than returning the right error).
//
// Applied globally in server.js before the route tree, so every mutation
// endpoint gets the check for free without each controller having to
// repeat it.

const { AppError, ErrorCodes } = require('../utils/errors');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// The one binary upload: a proof screenshot. Its route parses the body
// with express.raw(), which enforces these same types and a size limit.
const BINARY_UPLOADS = new Map([
  ['/api/verification/proof-image', new Set(['image/jpeg', 'image/png', 'image/webp'])],
]);

// A request "has a body" when it carries one of these indicators.
function hasBody(req) {
  const len = req.headers['content-length'];
  const te = req.headers['transfer-encoding'];
  return (len && parseInt(len, 10) > 0) || (te && te !== 'identity');
}

function requireJson(req, res, next) {
  if (!MUTATION_METHODS.has(req.method)) return next();
  if (!hasBody(req)) return next();

  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (BINARY_UPLOADS.get(req.path)?.has(ct)) return next();
  if (ct !== 'application/json') {
    return next(
      new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Content-Type must be application/json',
        415
      )
    );
  }

  next();
}

module.exports = { requireJson, BINARY_UPLOADS };
