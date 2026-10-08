// server/routes/verification.routes.js
const express = require('express');
const controller = require('../controllers/verification.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { createRateLimiter } = require('../middleware/rate-limit');
const { validateSubmit, validateReview } = require('../validators/verification.validator');

const { validateUuidParam } = require('../middleware/validate-uuid-param'); // Stage 16
const { AppError, ErrorCodes } = require('../utils/errors');

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

// Proof screenshots arrive as the raw image body (the browser resizes
// them first). express.raw() only accepts these types, up to 2 MB.
const parseImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' });
function readImage(req, res, next) {
  parseImage(req, res, (err) => {
    if (!err) return next();
    if (err.type === 'entity.too.large') {
      return next(new AppError(ErrorCodes.VALIDATION_ERROR, 'Screenshot is too large (2 MB at most)', 413));
    }
    return next(new AppError(ErrorCodes.VALIDATION_ERROR, 'Could not read that image', 400));
  });
}

// Opening and completing link-click tasks is quick and frequent (two calls
// per Visit task), so it gets its own, roomier budget.
const linkLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'Too many link-click tasks at once, please slow down.',
});

const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many uploads, please slow down.',
});

router.get('/mine', requireAuth, controller.listMine);
router.get('/to-review', requireAuth, controller.listToReview);
router.post('/tasks/:taskId', requireAuth, validateUuidParam('taskId'), writeLimiter, validate(validateSubmit), controller.submit);
router.post('/:id/review', requireAuth, validateUuidParam('id'), writeLimiter, validate(validateReview), controller.review);
router.post('/proof-image', requireAuth, uploadLimiter, readImage, controller.uploadProofImage);
router.post('/tasks/:taskId/open', requireAuth, validateUuidParam('taskId'), linkLimiter, controller.openLink);
router.post('/tasks/:taskId/complete', requireAuth, validateUuidParam('taskId'), linkLimiter, controller.completeLink);

module.exports = router;
