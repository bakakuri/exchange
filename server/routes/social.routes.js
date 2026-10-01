// server/routes/social.routes.js
const express = require('express');
const controller = require('../controllers/social.controller');
const { validate } = require('../middleware/validation');
const { requireAuth } = require('../middleware/auth');
const { validateCreate, validateUpdate } = require('../validators/social.validator');

const { validateUuidParam } = require('../middleware/validate-uuid-param'); // Stage 16

const router = express.Router();

// All of /api/social is the signed-in user's own linked accounts.
// Someone else's linked accounts are read via GET
// /api/profile/:username/social (profile.routes.js) - a read, not a
// mutation, so it lives with the rest of profile reads instead of here.
router.get('/', requireAuth, controller.listMine);
router.post('/', requireAuth, validate(validateCreate), controller.createMine);
router.patch('/:id', requireAuth, validateUuidParam('id'), validate(validateUpdate), controller.updateMine);
router.delete('/:id', requireAuth, validateUuidParam('id'), controller.removeMine);

module.exports = router;
