// server/controllers/credit.controller.js
const { asyncHandler } = require('../utils/async-handler');
const creditService = require('../services/credit.service');

// req.user.credits is the same cached balance write_ledger_entry keeps
// in sync (007_credit_ledger.sql) - no separate query needed.
const getBalance = asyncHandler(async (req, res) => {
  res.json({ credits: req.user.credits });
});

const getLedger = asyncHandler(async (req, res) => {
  const { limit, before } = req.query;
  const result = await creditService.getLedger(req.accessToken, req.user.id, { limit, before });
  res.json(result);
});

const getSummary = asyncHandler(async (req, res) => {
  const result = await creditService.getSummary(req.accessToken);
  res.json(result);
});

module.exports = { getBalance, getLedger, getSummary };
