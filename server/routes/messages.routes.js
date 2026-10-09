// server/routes/messages.routes.js
// Private messages (023). Members only; every route acts as the caller.
const express = require('express');
const controller = require('../controllers/messages.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { validateUuidParam } = require('../middleware/validate-uuid-param');
const { createRateLimiter } = require('../middleware/rate-limit');
const { AppError, ErrorCodes } = require('../utils/errors');
const {
  validateStart, validateSend, validateUpload, validateRead, validateBlock, validateUpdatesQuery,
} = require('../validators/messages.validator');

const router = express.Router();

// Generous for a conversation, tight for a spammer.
const sendLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: 'You are sending messages too fast. Wait a moment.',
});
const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Too many files at once, please slow down.',
});

// ?conversation= on the poll must be a UUID too.
function validateConversationQuery(req, res, next) {
  const errors = validateUpdatesQuery(req.query || {});
  if (errors.length) return next(new AppError(ErrorCodes.VALIDATION_ERROR, errors.join('; '), 400));
  next();
}

router.use(requireAuth);

router.get('/updates', validateConversationQuery, controller.updates);
router.get('/conversations', controller.listConversations);
router.post('/conversations', validate(validateStart), controller.startConversation);
router.get('/conversations/:id', validateUuidParam('id'), controller.getConversation);
router.post('/conversations/:id/messages', validateUuidParam('id'), sendLimiter, validate(validateSend), controller.send);
router.post('/conversations/:id/uploads', validateUuidParam('id'), uploadLimiter, validate(validateUpload), controller.createUpload);
router.post('/conversations/:id/read', validateUuidParam('id'), validate(validateRead), controller.markRead);
router.delete('/messages/:id', validateUuidParam('id'), controller.remove);
router.post('/blocks', validate(validateBlock), controller.block);
router.delete('/blocks/:userId', validateUuidParam('userId'), controller.unblock);

module.exports = router;
