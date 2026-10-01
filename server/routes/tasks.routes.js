// server/routes/tasks.routes.js
const express = require('express');
const controller = require('../controllers/task.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, controller.listOpen);
router.get('/:id', requireAuth, controller.getById);

module.exports = router;
