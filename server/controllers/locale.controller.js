// server/controllers/locale.controller.js
const localeService = require('../services/locale.service');

// GET /api/locale - { country, language } for the caller's own request.
// The answer depends on where the request came from, so no shared cache
// may store it.
function detect(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json(localeService.detect(req.headers));
}

module.exports = { detect };
