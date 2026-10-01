// server/controllers/reports.controller.js
// Handles user-facing report endpoints:
//   POST /api/reports        — submit a report
//   GET  /api/reports/mine   — list caller's own reports (paginated)

'use strict';

const { asyncHandler } = require('../utils/async-handler');
const service = require('../services/reports.service');
const { validateSubmitReport } = require('../validators/reports.validator');
const { validate } = require('../middleware/validation');
const { AppError, ErrorCodes } = require('../utils/errors');

const submitReport = asyncHandler(async (req, res) => {
  const report = await service.submitReport(req.user.id, req.body);
  res.status(201).json({ report });
});

const listMine = asyncHandler(async (req, res) => {
  const { before, limit } = req.query;
  const result = await service.listMine(req.user.id, { before, limit });
  res.json(result);
});

module.exports = { submitReport, listMine, validateSubmitReport, validate };
