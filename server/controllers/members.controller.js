// server/controllers/members.controller.js
const { asyncHandler } = require('../utils/async-handler');
const { AppError, ErrorCodes } = require('../utils/errors');
const membersService = require('../services/members.service');
const { parseDirectoryQuery } = require('../validators/members.validator');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;

const list = asyncHandler(async (req, res) => {
  const { errors, filters } = parseDirectoryQuery(req.query);
  if (errors.length) throw new AppError(ErrorCodes.VALIDATION_ERROR, errors.join('; '), 400);
  res.json(await membersService.list(req.accessToken, filters));
});

const counts = asyncHandler(async (req, res) => {
  res.json({ counts: await membersService.counts(req.accessToken) });
});

const getByUsername = asyncHandler(async (req, res) => {
  if (!USERNAME_RE.test(req.params.username)) throw new AppError(ErrorCodes.NOT_FOUND, 'Member not found', 404);
  res.json({ member: await membersService.getByUsername(req.accessToken, req.params.username) });
});

// The page is open and visible: requireAuth has already recorded it.
const ping = (req, res) => res.status(204).end();

module.exports = { list, counts, getByUsername, ping };
