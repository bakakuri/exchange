// server/controllers/achievement.controller.js
const { asyncHandler } = require('../utils/async-handler');
const achievementService = require('../services/achievement.service');
const profileService = require('../services/profile.service');

const listCatalog = asyncHandler(async (req, res) => {
  const result = await achievementService.listCatalog(req.accessToken);
  res.json(result);
});

const listMine = asyncHandler(async (req, res) => {
  const result = await achievementService.listUnlockedForUser(req.accessToken, req.user.id);
  res.json(result);
});

// Same composition as activity.controller.js's listByUsername: not an
// authorization boundary (user_achievements_select_all already lets any
// authenticated caller read anyone's unlocks), just profile.service.js's
// username-to-id lookup reused here.
const listByUsername = asyncHandler(async (req, res) => {
  const profile = await profileService.getProfileByUsername(req.accessToken, req.params.username);
  const result = await achievementService.listUnlockedForUser(req.accessToken, profile.id);
  res.json(result);
});

module.exports = { listCatalog, listMine, listByUsername };
