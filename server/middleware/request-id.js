// server/middleware/request-id.js
// Attaches a UUID v4 request ID to every inbound request so a single
// transaction can be correlated across logs, error responses and upstream
// calls without any identifying personal data. The ID is echoed back in
// the X-Request-Id response header so the client can include it in a
// support report.
//
// Uses Node's built-in crypto.randomUUID() — no extra dependency.

const { randomUUID } = require('crypto');

function requestId(req, res, next) {
  // Honour an upstream proxy's ID (e.g. Vercel forwards its own) so the
  // ID chain is preserved through the stack, otherwise generate a fresh one.
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = { requestId };
