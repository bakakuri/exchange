// server/controllers/profile.controller.js
const { asyncHandler } = require('../utils/async-handler');
const profileService = require('../services/profile.service');
const socialService = require('../services/social.service');
const mediaService = require('../services/media.service');
const { contentTypeOf } = require('../utils/images');

// middleware/auth.js's requireAuth already re-reads the full profile
// from the database on every request and attaches it as req.user, so
// "get my own profile" needs no extra query - reusing it also
// guarantees this endpoint can never disagree with /auth/session about
// what the signed-in user's profile looks like.
const getMe = asyncHandler(async (req, res) => {
  res.json({ profile: req.user });
});

const updateMe = asyncHandler(async (req, res) => {
  const profile = await profileService.updateOwnProfile(req.user.id, req.accessToken, req.body);
  res.json({ profile });
});

const getByUsername = asyncHandler(async (req, res) => {
  const profile = await profileService.getProfileByUsername(req.accessToken, req.params.username);
  res.json({ profile });
});

// Composes profile + social lookups rather than adding a foreign-key
// join to social.service.js - profile.service.js still owns "resolve a
// username to a profile", social.service.js still owns "list a user's
// linked accounts", this just calls both.
const getSocialByUsername = asyncHandler(async (req, res) => {
  const profile = await profileService.getProfileByUsername(req.accessToken, req.params.username);
  const social_profiles = await socialService.listForUser(req.accessToken, profile.id);
  res.json({ social_profiles });
});

// Profile photos (022): the raw image body in, the updated profile out.
const uploadPhoto = (kind) => asyncHandler(async (req, res) => {
  const profile = await mediaService.uploadPhoto(req.user.id, kind, req.body, contentTypeOf(req));
  res.status(201).json({ profile });
});

const removePhoto = (kind) => asyncHandler(async (req, res) => {
  const profile = await mediaService.removePhoto(req.user.id, kind);
  res.json({ profile });
});

module.exports = { getMe, updateMe, getByUsername, getSocialByUsername, uploadPhoto, removePhoto };
