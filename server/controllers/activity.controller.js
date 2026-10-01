// server/controllers/activity.controller.js
const { asyncHandler } = require('../utils/async-handler');
const activityService = require('../services/activity.service');
const profileService = require('../services/profile.service');

const listMine = asyncHandler(async (req, res) => {
  const { limit, before } = req.query;
  const result = await activityService.listForUser(req.accessToken, req.user.id, { limit, before });
  res.json(result);
});

// Composes profile.service.js's username resolution with this file's
// own listForUser(), same shape as profile.controller.js's
// getSocialByUsername - activity_select_all (014_rls.sql) already makes
// any user's feed readable to any authenticated caller, so this is
// purely a convenience lookup, not an authorization boundary.
const listByUsername = asyncHandler(async (req, res) => {
  const { limit, before } = req.query;
  const profile = await profileService.getProfileByUsername(req.accessToken, req.params.username);
  const result = await activityService.listForUser(req.accessToken, profile.id, { limit, before });
  res.json(result);
});

module.exports = { listMine, listByUsername };
