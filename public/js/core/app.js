// js/core/app.js - bootstraps the application.
import { init as initRouter, setRouteGuard } from './router.js';
import './routes-manifest.js';
import { authGuard } from './route-guards.js';
import { initAuth } from '../auth/auth.js';
import { initAuthNav } from '../auth/auth-nav.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Session must be hydrated before the first route renders, so a
  // guestOnly page like /login doesn't flash before redirecting an
  // already-signed-in visitor away, and a protected page doesn't flash
  // before redirecting a signed-out one to /login.
  await initAuth();
  setRouteGuard(authGuard);
  initAuthNav();
  initRouter();
});
