// server/controllers/campaign.controller.js
const { asyncHandler } = require('../utils/async-handler');
const campaignService = require('../services/campaign.service');

const create = asyncHandler(async (req, res) => {
  const campaign = await campaignService.create(req.accessToken, req.body);
  res.status(201).json({ campaign });
});

const listMine = asyncHandler(async (req, res) => {
  const { limit, before, status } = req.query;
  const result = await campaignService.listMine(req.accessToken, req.user.id, { limit, before, status });
  res.json(result);
});

const getMineById = asyncHandler(async (req, res) => {
  const campaign = await campaignService.getMineById(req.accessToken, req.params.id, req.user.id);
  res.json({ campaign });
});

const update = asyncHandler(async (req, res) => {
  const campaign = await campaignService.update(req.accessToken, req.params.id, req.body);
  res.json({ campaign });
});

const pause = asyncHandler(async (req, res) => {
  const campaign = await campaignService.setPauseState(req.accessToken, req.params.id, true);
  res.json({ campaign });
});

const resume = asyncHandler(async (req, res) => {
  const campaign = await campaignService.setPauseState(req.accessToken, req.params.id, false);
  res.json({ campaign });
});

const cancel = asyncHandler(async (req, res) => {
  const campaign = await campaignService.cancel(req.accessToken, req.params.id, req.body?.reason);
  res.json({ campaign });
});

module.exports = { create, listMine, getMineById, update, pause, resume, cancel };
