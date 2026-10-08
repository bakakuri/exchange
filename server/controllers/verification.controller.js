// server/controllers/verification.controller.js
const { asyncHandler } = require('../utils/async-handler');
const verificationService = require('../services/verification.service');

const listMine = asyncHandler(async (req, res) => {
  const { limit, before, status } = req.query;
  const result = await verificationService.listMine(req.accessToken, req.user.id, { limit, before, status });
  res.json(result);
});

const listToReview = asyncHandler(async (req, res) => {
  const { limit, before, status } = req.query;
  const result = await verificationService.listToReview(req.accessToken, req.user.id, { limit, before, status });
  res.json(result);
});

const submit = asyncHandler(async (req, res) => {
  const completion = await verificationService.submit(req.accessToken, req.params.taskId, req.body);
  res.status(201).json({ completion });
});

const review = asyncHandler(async (req, res) => {
  const completion = await verificationService.review(req.accessToken, req.params.id, req.body);
  res.json({ completion });
});

// Body is the raw image (express.raw in verification.routes.js).
const uploadProofImage = asyncHandler(async (req, res) => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const result = await verificationService.uploadProofImage(req.user.id, req.body, contentType);
  res.status(201).json(result);
});

const openLink = asyncHandler(async (req, res) => {
  const result = await verificationService.openLink(req.accessToken, req.params.taskId);
  res.json(result);
});

const completeLink = asyncHandler(async (req, res) => {
  const completion = await verificationService.completeLink(req.accessToken, req.params.taskId);
  res.status(201).json({ completion });
});

module.exports = { listMine, listToReview, submit, review, uploadProofImage, openLink, completeLink };
