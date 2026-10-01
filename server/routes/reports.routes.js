// server/routes/reports.routes.js
// User-facing moderation reports.
//
// POST /api/reports       — submit a report (authenticated; rate-limited)
// GET  /api/reports/mine  — caller's own reports, cursor-paginated

'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { validateSubmitReport } = require('../validators/reports.validator');
const controller = require('../controllers/reports.controller');
const { createRateLimiter } = require('../middleware/rate-limit');

const router = express.Router();

// Tighter rate limit on submission — reports have moderation consequences.
const reportSubmitLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/', requireAuth, reportSubmitLimiter, validate(validateSubmitReport), controller.submitReport);
router.get('/mine', requireAuth, controller.listMine);

module.exports = router;
