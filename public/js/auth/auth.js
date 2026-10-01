// js/auth/auth.js
// The one authentication state manager: every register, login, logout
// and token refresh in the app goes through this module, and it is the
// only thing that writes store.user / store.session. UI code
// (login.js, register.js, auth-nav.js, route-guards.js...) calls these
// functions and reacts to store state - it never talks to the API or to
// localStorage directly.

import { store } from '../core/state.js';
import { navigate } from '../core/router.js';
import { api } from '../shared/api.js';
import { loadSession, saveSession, clearSession } from './session.js';

const REFRESH_BUFFER_MS = 60_000; // refresh 60s before the access token actually expires
let refreshTimer = null;

function applySession(session, user) {
  store.setState({ session, user });
  if (session && user) saveSession(session, user);
  else clearSession();
  scheduleRefresh(session);
}

function scheduleRefresh(session) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (!session?.expires_at) return;

  const expiresAtMs = session.expires_at * 1000; // Supabase gives seconds since epoch
  const delay = Math.max(expiresAtMs - Date.now() - REFRESH_BUFFER_MS, 0);

  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => applySession(null, null));
  }, delay);
}

// Called once at app bootstrap (see core/app.js), before the router does
// its first render, so guarded routes see accurate auth state from the
// start instead of flashing signed-out.
export async function initAuth() {
  const stored = loadSession();
  if (!stored) return;

  // Trust the stored session optimistically so the UI doesn't flash
  // signed-out, then confirm it with the server and pick up any change
  // to the profile (role/credits/xp) since the last visit.
  store.setState({ session: stored.session, user: stored.user });
  scheduleRefresh(stored.session);

  try {
    const { user } = await api.auth.session();
    applySession(stored.session, user);
  } catch {
    // The stored access token is no longer valid - fall back to the
    // refresh token before giving up on the session entirely.
    try {
      await refreshSession();
    } catch {
      applySession(null, null);
    }
  }
}

export async function register(fields) {
  const result = await api.auth.register(fields);
  // Supabase only returns a session immediately when email confirmation
  // is disabled for the project; otherwise the caller must confirm by
  // email first and result.session is null. Callers (register.js)
  // branch on that to decide whether to sign the person in or ask them
  // to check their inbox.
  if (result.session && result.user) applySession(result.session, result.user);
  return result;
}

export async function login(fields) {
  const { session, user } = await api.auth.login(fields);
  applySession(session, user);
  return user;
}

export async function logout() {
  try {
    await api.auth.logout();
  } catch {
    // Even if the server call fails (e.g. the token already expired),
    // the client should still forget the session.
  }
  applySession(null, null);
  navigate('/');
}

export async function refreshSession() {
  const current = store.getState().session;
  if (!current?.refresh_token) throw new Error('No session to refresh');
  const { session, user } = await api.auth.refresh(current.refresh_token);
  applySession(session, user);
  return user;
}

export function requestPasswordReset(email) {
  return api.auth.requestPasswordReset(email);
}

export function confirmPasswordReset(accessToken, password) {
  return api.auth.confirmPasswordReset(accessToken, password);
}

export function isAuthenticated() {
  return Boolean(store.getState().user);
}

// Called by other features (e.g. a profile edit) when the signed-in
// user's data changes for a reason other than login/logout/refresh, so
// the cached copy in the store and in localStorage stay correct without
// those features reaching into session.js or store.setState themselves -
// this stays the one place that writes store.user.
export function updateCachedUser(patch) {
  const { session, user } = store.getState();
  if (!user) return;
  applySession(session, { ...user, ...patch });
}
