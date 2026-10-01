// server/controllers/task.controller.js
const { asyncHandler } = require('../utils/async-handler');
const taskService = require('../services/task.service');

const listOpen = asyncHandler(async (req, res) => {
  const { limit, before, platform, task_type } = req.query;
  const result = await taskService.listOpen(req.accessToken, req.user.id, {
    limit,
    before,
    platform,
    taskType: task_type,
  });
  res.json(result);
});

const getById = asyncHandler(async (req, res) => {
  const task = await taskService.getById(req.accessToken, req.user.id, req.params.id);
  res.json({ task });
});

module.exports = { listOpen, getById };
