// server/controllers/social.controller.js
const { asyncHandler } = require('../utils/async-handler');
const socialService = require('../services/social.service');

const listMine = asyncHandler(async (req, res) => {
  const social_profiles = await socialService.listForUser(req.accessToken, req.user.id);
  res.json({ social_profiles });
});

const createMine = asyncHandler(async (req, res) => {
  const social_profile = await socialService.create(req.accessToken, req.user.id, req.body);
  res.status(201).json({ social_profile });
});

const updateMine = asyncHandler(async (req, res) => {
  const social_profile = await socialService.update(req.accessToken, req.params.id, req.body);
  res.json({ social_profile });
});

const removeMine = asyncHandler(async (req, res) => {
  await socialService.remove(req.accessToken, req.params.id);
  res.status(204).end();
});

module.exports = { listMine, createMine, updateMine, removeMine };
