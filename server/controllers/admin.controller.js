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

// ── 022 ─────────────────────────────────────────────────────────────────────

const updateProfile = asyncHandler(async (req, res) => {
  const user = await adminService.updateProfile(req.accessToken, req.params.id, req.body);
  res.json({ user });
});

const listCampaigns = asyncHandler(async (req, res) => {
  const { status, search, before, limit } = req.query;
  res.json(await adminService.listCampaigns({ status, search, before, limit }));
});

const campaignAction = (action) => asyncHandler(async (req, res) => {
  const campaign = await adminService.campaignAction(req.accessToken, req.params.id, action, req.body.reason.trim());
  res.json({ campaign });
});

const listCompletions = asyncHandler(async (req, res) => {
  const { status, search, before, limit } = req.query;
  res.json(await adminService.listCompletions({ status, search, before, limit }));
});

const reviewCompletion = asyncHandler(async (req, res) => {
  const completion = await adminService.reviewCompletion(req.accessToken, req.params.id, req.body);
  res.json({ completion });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { audience, username, title, body } = req.body;
  res.status(201).json(await adminService.sendMessage(req.accessToken, { audience, username, title, body }));
});

const listMessages = asyncHandler(async (req, res) => {
  res.json(await adminService.listMessages({ limit: req.query.limit }));
});

module.exports = {
  listUsers, getUser, updateUser, adjustCredits, getStats, listAudit, listReports, resolveReport,
  overturnRejection, reverseReward,
  updateProfile, listCampaigns, campaignAction, listCompletions, reviewCompletion, sendMessage, listMessages,
};
