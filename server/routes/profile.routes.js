// server/routes/profile.routes.js
const express = require('express');
const controller = require('../controllers/profile.controller');
const { validate } = require('../middleware/validation');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rate-limit');
const { readImage } = require('../middleware/read-image');
const { validateUpdateProfile } = require('../validators/profile.validator');

const router = express.Router();

// Profile photos (022): a few changes in a row are normal (trying a
// crop again), dozens are not.
const photoLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many photo changes, please slow down.',
});

// Every profile route requires a session - see 014_rls.sql: the
// `anon` role has no grant on public.profiles at all, so an
// unauthenticated request would fail at the database layer regardless.
router.get('/me', requireAuth, controller.getMe);
router.patch('/me', requireAuth, validate(validateUpdateProfile), controller.updateMe);

// The body is the image itself (the browser crops and resizes it first).
router.post('/me/avatar', requireAuth, photoLimiter, readImage(), controller.uploadPhoto('avatar'));
router.delete('/me/avatar', requireAuth, photoLimiter, controller.removePhoto('avatar'));
router.post('/me/cover', requireAuth, photoLimiter, readImage(), controller.uploadPhoto('cover'));
router.delete('/me/cover', requireAuth, photoLimiter, controller.removePhoto('cover'));

// Must come after /me, or "me" would be captured as a :username value.
router.get('/:username', requireAuth, controller.getByUsername);
router.get('/:username/social', requireAuth, controller.getSocialByUsername);

module.exports = router;
