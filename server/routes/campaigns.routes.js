// server/routes/campaigns.routes.js
const express = require('express');
const controller = require('../controllers/campaign.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { createRateLimiter } = require('../middleware/rate-limit');
const { validateCreate, validateUpdate, validateCancel } = require('../validators/campaign.validator');

const { validateUuidParam } = require('../middleware/validate-uuid-param'); // Stage 16

const router = express.Router();

// Every action here has direct economic consequences - creating spends
// credits, pausing/resuming/cancelling changes whether/how a budget can
// still be spent - same rationale as Stage 3's authLimiter and Stage 8's
// writeLimiter (spec section 40).
const writeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many campaign changes, please slow down.',
});

router.post('/', requireAuth, writeLimiter, validate(validateCreate), controller.create);
router.get('/mine', requireAuth, controller.listMine);

// Must come after /mine, or "mine" would be captured as a :id value -
// same reasoning as profile.routes.js's /me before /:username.
router.get('/:id', requireAuth, validateUuidParam('id'), controller.getMineById);
router.patch('/:id', requireAuth, validateUuidParam('id'), writeLimiter, validate(validateUpdate), controller.update);
router.post('/:id/pause', requireAuth, validateUuidParam('id'), writeLimiter, controller.pause);
router.post('/:id/resume', requireAuth, validateUuidParam('id'), writeLimiter, controller.resume);
router.post('/:id/cancel', requireAuth, validateUuidParam('id'), writeLimiter, validate(validateCancel), controller.cancel);

module.exports = router;
