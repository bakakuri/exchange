// server/controllers/referral.controller.js
const { asyncHandler } = require('../utils/async-handler');
const referralService = require('../services/referral.service');

const claim = asyncHandler(async (req, res) => {
  await referralService.claim(req.accessToken, req.body.code);
  res.status(204).end();
});

const listMine = asyncHandler(async (req, res) => {
  const { limit, before } = req.query;
  const result = await referralService.listMine(req.accessToken, req.user.id, { limit, before });
  res.json(result);
});

module.exports = { claim, listMine };
