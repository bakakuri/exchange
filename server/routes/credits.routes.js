// server/routes/credits.routes.js
// Read-only for now: every way a balance actually changes (campaign
// budgets, task rewards, referrals) belongs to its own stage, and an
// admin-adjustment endpoint belongs to Stage 14 even though the
// database function for it already exists (015_functions.sql).

const express = require('express');
const controller = require('../controllers/credit.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/balance', requireAuth, controller.getBalance);
router.get('/ledger', requireAuth, controller.getLedger);
router.get('/summary', requireAuth, controller.getSummary);

module.exports = router;
