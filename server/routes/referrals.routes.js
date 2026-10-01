// server/routes/referrals.routes.js
const express = require('express');
const controller = require('../controllers/referral.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { createRateLimiter } = require('../middleware/rate-limit');
const { validateClaim } = require('../validators/referral.validator');

const router = express.Router();

// Tighter than the general API limiter - same rationale as verification's
// writeLimiter (Stage 8): claiming a code has direct economic consequences
// (it seeds a referral that pays out real credits on the referred user's
// first approved completion), so it's worth throttling independently of
// read traffic on the rest of /api/referrals. Also blunts brute-forcing
// someone else's 8-character code by trial and error.
const claimLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many referral claim attempts, please slow down.',
});

router.get('/mine', requireAuth, controller.listMine);
router.post('/claim', requireAuth, claimLimiter, validate(validateClaim), controller.claim);

module.exports = router;
