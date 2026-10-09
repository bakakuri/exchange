// server/routes/admin.routes.js
// All routes here require both requireAuth (token valid, account active)
// and requireAdmin (role = 'admin', verified against the database-backed
// req.user, never a JWT claim). No business logic lives here.

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { validate } = require('../middleware/validation');
const { validateUuidParam } = require('../middleware/validate-uuid-param');  // Stage 16
const {
  validateUpdateUser, validateCreditAdjustment, validateDecisionNote,
  validateAdminProfile, validateCampaignAction, validateAdminMessage,
} = require('../validators/admin.validator');
const { validateResolveReport } = require('../validators/reports.validator');
const { validateReview } = require('../validators/verification.validator');
const controller = require('../controllers/admin.controller');

const router = Router();

// Every admin route needs both guards. Applying them at the router level
// once is simpler and less error-prone than repeating on each route.
router.use(requireAuth, requireAdmin);

// Platform-wide stats
router.get('/stats', controller.getStats);

// Audit log
router.get('/audit', controller.listAudit);

// User management
router.get('/users', controller.listUsers);
router.get('/users/:id', validateUuidParam('id'), controller.getUser);
router.patch('/users/:id', validateUuidParam('id'), validate(validateUpdateUser), controller.updateUser);
router.post('/users/:id/credits', validateUuidParam('id'), validate(validateCreditAdjustment), controller.adjustCredits);
// Edit or clean up a profile, photos included (022).
router.patch('/users/:id/profile', validateUuidParam('id'), validate(validateAdminProfile), controller.updateProfile);

// Every campaign (022): list, pause, resume, cancel - always with a reason.
router.get('/campaigns', controller.listCampaigns);
router.post('/campaigns/:id/pause', validateUuidParam('id'), validate(validateCampaignAction), controller.campaignAction('pause'));
router.post('/campaigns/:id/resume', validateUuidParam('id'), validate(validateCampaignAction), controller.campaignAction('resume'));
router.post('/campaigns/:id/cancel', validateUuidParam('id'), validate(validateCampaignAction), controller.campaignAction('cancel'));

// Every submitted proof (022): list, approve or reject.
router.get('/completions', controller.listCompletions);
router.post('/completions/:id/review', validateUuidParam('id'), validate(validateReview), controller.reviewCompletion);

// Messages to one member or everyone (022).
router.get('/messages', controller.listMessages);
router.post('/messages', validate(validateAdminMessage), controller.sendMessage);

// Reports (moderation)
router.get('/reports', controller.listReports);
router.post('/reports/:id/resolve', validateUuidParam('id'), validate(validateResolveReport), controller.resolveReport);

// Appeals and undone-action reports (021): act on the proof itself.
router.post('/completions/:id/overturn', validateUuidParam('id'), validate(validateDecisionNote), controller.overturnRejection);
router.post('/completions/:id/reverse', validateUuidParam('id'), validate(validateDecisionNote), controller.reverseReward);

module.exports = router;
