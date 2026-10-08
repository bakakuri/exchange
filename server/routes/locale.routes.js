// server/routes/locale.routes.js
// Public (no sign-in): the first visit picks its language before anyone
// has an account.
const express = require('express');
const controller = require('../controllers/locale.controller');

const router = express.Router();

router.get('/', controller.detect);

module.exports = router;
