// server/routes/members.routes.js
// The members directory and presence (022). Members only.
const express = require('express');
const controller = require('../controllers/members.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, controller.list);
router.get('/counts', requireAuth, controller.counts);
// /u/ keeps a member called "counts" reachable.
router.get('/u/:username', requireAuth, controller.getByUsername);

module.exports = router;
