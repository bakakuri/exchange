// js/auth/session.js
// Persists the signed-in session (Supabase access/refresh tokens) and
// the profile-enriched user object to localStorage, so a page refresh
// doesn't sign the person out. This is the ONLY module that touches
// localStorage for auth - everything else goes through auth.js.

const STORAGE_KEY = 'exchange.session';

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.session?.access_token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session, user) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ session, user }));
  } catch {
    // Storage may be unavailable (private browsing, quota exceeded) -
    // the app still works, it just won't survive a refresh.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
