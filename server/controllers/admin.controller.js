// server/controllers/admin.controller.js
// One function per admin endpoint. No business logic - only HTTP
// shape: extract params, call service, format response.

const { asyncHandler } = require('../utils/async-handler');
const adminService = require('../services/admin.service');
const reportsService = require('../services/reports.service');

const listUsers = asyncHandler(async (req, res) => {
  const { search, limit, before } = req.query;
  const result = await adminService.listUsers({ search, limit, before });
  res.json(result);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUser(req.params.id);
  res.json({ user });
});

const updateUser = asyncHandler(async (req, res) => {
  const { role, status, reason } = req.body;
  await adminService.updateUser(req.accessToken, req.params.id, { role, status, reason });
  res.status(204).end();
});

const adjustCredits = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;
  await adminService.adjustCredits(req.accessToken, req.params.id, { amount, reason });
  res.status(204).end();
});

const getStats = asyncHandler(async (_req, res) => {
  const stats = await adminService.getStats();
  res.json({ stats });
});

const listAudit = asyncHandler(async (req, res) => {
  const { limit, before } = req.query;
  const result = await adminService.listAudit({ limit, before });
  res.json(result);
});

const listReports = asyncHandler(async (req, res) => {
  const { status = 'open', limit, before } = req.query;
  const result = await adminService.listReports({ status, limit, before });
  res.json(result);
});

const resolveReport = asyncHandler(async (req, res) => {
  const { decision, note = '' } = req.body;
  await reportsService.resolveReport(req.accessToken, req.params.id, { decision, note });
  res.status(204).end();
});

const overturnRejection = asyncHandler(async (req, res) => {
  await adminService.overturnRejection(req.accessToken, req.params.id, { note: req.body.note });
  res.status(204).end();
});

const reverseReward = asyncHandler(async (req, res) => {
  const result = await adminService.reverseReward(req.accessToken, req.params.id, { note: req.body.note });
  res.json(result);
});

module.exports = {
  listUsers, getUser, updateUser, adjustCredits, getStats, listAudit, listReports, resolveReport,
  overturnRejection, reverseReward,
};
