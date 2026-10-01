// js/auth/routes.js
// Registers this feature's routes with the router core. guestOnly means
// an already-signed-in visitor is redirected to "/" instead of seeing
// the page (see core/route-guards.js).

import { registerRoute } from '../core/router.js';

registerRoute('/login', {
  fragment: '/pages/login.html',
  module: '/js/auth/login.js',
  title: 'Sign in · Exchange',
  guestOnly: true,
});

registerRoute('/register', {
  fragment: '/pages/register.html',
  module: '/js/auth/register.js',
  title: 'Create account · Exchange',
  guestOnly: true,
});

// Not guestOnly: this also handles the "set a new password" step from a
// recovery email link, which should work even if the visitor happens to
// still have an older session in this browser.
registerRoute('/password-reset', {
  fragment: '/pages/password-reset.html',
  module: '/js/auth/password-reset.js',
  title: 'Reset password · Exchange',
});
