// server/controllers/auth.controller.js
// Translates HTTP requests into calls on auth.service.js and back into
// HTTP responses. No business logic lives here - see the service.

const { asyncHandler } = require('../utils/async-handler');
const authService = require('../services/auth.service');

const register = asyncHandler(async (req, res) => {
  const { email, password, username, referral_code } = req.body;
  const result = await authService.register({ email, password, username, referral_code });
  res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password });
  res.json(result);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.accessToken);
  res.status(204).end();
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refresh_token);
  res.json(result);
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  // Always the same response whether or not the email is registered, so
  // this endpoint can't be used to enumerate accounts. A genuine error
  // (e.g. rate limited) still propagates via asyncHandler -> next(err).
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

const confirmPasswordReset = asyncHandler(async (req, res) => {
  await authService.confirmPasswordReset(req.body.access_token, req.body.password);
  res.json({ message: 'Password updated.' });
});

const session = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

module.exports = { register, login, logout, refresh, requestPasswordReset, confirmPasswordReset, session };
