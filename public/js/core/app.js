// js/core/app.js - bootstraps the application.
import { init as initRouter, refresh as refreshRoute, setRouteGuard } from './router.js';
import './routes-manifest.js';
import { authGuard } from './route-guards.js';
import { initAuth } from '../auth/auth.js';
import { initAuthNav } from '../auth/auth-nav.js';
import { initNavMenu } from './nav-menu.js';
import { initNavBadges } from './nav-badges.js';
import { initPresence } from './presence.js';
import { initMessagesPoller } from './messages-poller.js';
import { initTheme } from './theme.js';
import { initLanguage } from './language.js';
import { initLanguageMenu } from './language-menu.js';
import { eventBus } from './events.js';

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // initAuth() puts the stored session into the store synchronously, then
  // confirms it with the server. Starting the shell before awaiting lets
  // it show the cached member (name, credits) at once; it re-renders if
  // the server check changes anything.
  const authReady = initAuth();
  // Reads the stored session's account language, so it starts after
  // initAuth() has put that session in the store.
  const languageReady = initLanguage();
  initAuthNav();
  initNavMenu();
  initLanguageMenu();

  // The session must be confirmed before the first route renders, so a
  // guestOnly page like /login doesn't flash before redirecting a
  // signed-in visitor away, and a protected page doesn't flash before
  // redirecting a signed-out one to /login. The language must be known
  // too, so the first page renders translated.
  await Promise.all([authReady, languageReady]);
  setRouteGuard(authGuard);
  initNavBadges();
  initPresence();
  initMessagesPoller();
  initRouter();
  eventBus.on('language:change', () => refreshRoute());
});
