// server/routes/activity.routes.js
const express = require('express');
const controller = require('../controllers/activity.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', requireAuth, controller.listMine);

// Must come after /mine, or "mine" would be captured as a :username
// value - same reasoning as profile.routes.js's /me before /:username.
router.get('/:username', requireAuth, controller.listByUsername);

module.exports = router;
