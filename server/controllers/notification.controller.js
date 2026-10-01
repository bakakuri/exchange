// server/controllers/notification.controller.js
const { asyncHandler } = require('../utils/async-handler');
const notificationService = require('../services/notification.service');

const listMine = asyncHandler(async (req, res) => {
  const { limit, before, unread } = req.query;
  const result = await notificationService.listMine(req.accessToken, req.user.id, {
    limit,
    before,
    unreadOnly: unread === 'true',
  });
  res.json(result);
});

const unreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.getUnreadCount(req.accessToken, req.user.id);
  res.json(result);
});

const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markRead(req.accessToken, req.params.id, req.user.id);
  res.json({ notification });
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.accessToken, req.user.id);
  res.status(204).end();
});

module.exports = { listMine, unreadCount, markRead, markAllRead };
