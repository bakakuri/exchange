// server/routes/presence.routes.js
// POST /api/presence - the open page says "still here" every two minutes;
// requireAuth records it (presence.service.js), the handler only answers.
const express = require('express');
const controller = require('../controllers/members.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, controller.ping);

module.exports = router;
