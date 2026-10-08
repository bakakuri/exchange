// server/routes/admin.routes.js
// All routes here require both requireAuth (token valid, account active)
// and requireAdmin (role = 'admin', verified against the database-backed
// req.user, never a JWT claim). No business logic lives here.

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { validate } = require('../middleware/validation');
const { validateUuidParam } = require('../middleware/validate-uuid-param');  // Stage 16
const { validateUpdateUser, validateCreditAdjustment, validateDecisionNote } = require('../validators/admin.validator');
const { validateResolveReport } = require('../validators/reports.validator');
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

// Reports (moderation)
router.get('/reports', controller.listReports);
router.post('/reports/:id/resolve', validateUuidParam('id'), validate(validateResolveReport), controller.resolveReport);

// Appeals and undone-action reports (021): act on the proof itself.
router.post('/completions/:id/overturn', validateUuidParam('id'), validate(validateDecisionNote), controller.overturnRejection);
router.post('/completions/:id/reverse', validateUuidParam('id'), validate(validateDecisionNote), controller.reverseReward);

module.exports = router;
