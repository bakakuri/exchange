// server/routes/auth.routes.js
const express = require('express');
const controller = require('../controllers/auth.controller');
const { validate } = require('../middleware/validation');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  validateRegister,
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordResetConfirm,
  validateRefresh,
} = require('../validators/auth.validator');

const router = express.Router();

// Tighter than the general API limiter: these are the endpoints brute
// force and account-enumeration attacks target (spec section 40).
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts, please try again later.',
});

router.post('/register', authLimiter, validate(validateRegister), controller.register);
router.post('/login', authLimiter, validate(validateLogin), controller.login);
router.post('/refresh', validate(validateRefresh), controller.refresh);
router.post('/logout', requireAuth, controller.logout);
router.post('/password-reset/request', authLimiter, validate(validatePasswordResetRequest), controller.requestPasswordReset);
router.post('/password-reset/confirm', authLimiter, validate(validatePasswordResetConfirm), controller.confirmPasswordReset);
router.get('/session', requireAuth, controller.session);

module.exports = router;
