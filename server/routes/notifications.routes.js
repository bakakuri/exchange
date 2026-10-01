// server/routes/notifications.routes.js
const express = require('express');
const controller = require('../controllers/notification.controller');
const { requireAuth } = require('../middleware/auth');

const { validateUuidParam } = require('../middleware/validate-uuid-param'); // Stage 16

const router = express.Router();

router.get('/', requireAuth, controller.listMine);
router.get('/unread-count', requireAuth, controller.unreadCount);
router.patch('/:id/read', requireAuth, validateUuidParam('id'), controller.markRead);
router.post('/read-all', requireAuth, controller.markAllRead);

module.exports = router;
