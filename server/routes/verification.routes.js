// server/routes/verification.routes.js
const express = require('express');
const controller = require('../controllers/verification.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { createRateLimiter } = require('../middleware/rate-limit');
const { validateSubmit, validateReview } = require('../validators/verification.validator');

const { validateUuidParam } = require('../middleware/validate-uuid-param'); // Stage 16

const router = express.Router();

// Tighter than the general API limiter, same rationale as Stage 3's
// authLimiter (spec section 40): submitting/reviewing proof has direct
// economic consequences (a reviewed-and-approved submission pays out
// real credits), so both are worth throttling independently of read
// traffic on the rest of /api/verification.
const writeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many submissions or reviews, please slow down.',
});

router.get('/mine', requireAuth, controller.listMine);
router.get('/to-review', requireAuth, controller.listToReview);
router.post('/tasks/:taskId', requireAuth, validateUuidParam('taskId'), writeLimiter, validate(validateSubmit), controller.submit);
router.post('/:id/review', requireAuth, validateUuidParam('id'), writeLimiter, validate(validateReview), controller.review);

module.exports = router;
