// js/core/route-guards.js
// The single auth guard wired into the router via setRouteGuard() in
// app.js. Kept separate from router.js so the router core stays generic
// and never needs to import anything auth-specific.

import { store } from './state.js';

export function authGuard(route) {
  const user = store.getState().user;
  const isAuthenticated = Boolean(user);

  if (route.protected && !isAuthenticated) return '/login';
  if (route.guestOnly && isAuthenticated) return '/';

  // Admin-only routes redirect non-admin authenticated users to home.
  // Non-authenticated users hit the protected guard above first, so
  // here we only have to handle the "signed in but not admin" case.
  if (route.adminOnly && user?.role !== 'admin') return '/';

  return null;
}
