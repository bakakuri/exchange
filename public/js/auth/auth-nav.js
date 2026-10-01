// js/auth/auth-nav.js
// Keeps the app header's auth slot (#auth-nav, in index.html) in sync
// with sign-in state: sign in / sign up links when signed out, username
// + sign out button when signed in. Re-renders on every store change so
// it never drifts from what login.js/register.js/auth.js actually did.

import { store } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { logout } from './auth.js';
import { qs } from '../shared/dom.js';

function render() {
  const el = qs('#auth-nav');
  if (!el) return;

  const user = store.getState().user;
  el.innerHTML = '';

  if (user) {
    const creditsLink = document.createElement('a');
    creditsLink.href = '/credits';
    creditsLink.setAttribute('data-link', '');
    creditsLink.textContent = `${user.credits} credits`;

    const profileLink = document.createElement('a');
    profileLink.href = '/profile';
    profileLink.setAttribute('data-link', '');
    profileLink.textContent = user.username || user.email;

    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'app-nav__logout';
    signOut.textContent = 'Sign out';
    signOut.addEventListener('click', () => logout());

    el.append(creditsLink, profileLink, signOut);

    // Admin link — only rendered for admin users so it doesn't clutter
    // the nav for regular users. Not a security boundary (server + route
    // guard handle that); purely a convenience link.
    if (user.role === 'admin') {
      const adminLink = document.createElement('a');
      adminLink.href = '/admin';
      adminLink.setAttribute('data-link', '');
      adminLink.className = 'app-nav__admin';
      adminLink.textContent = 'Admin';
      el.insertBefore(adminLink, signOut);
    }
  } else {
    const signIn = document.createElement('a');
    signIn.href = '/login';
    signIn.setAttribute('data-link', '');
    signIn.textContent = 'Sign in';

    const signUp = document.createElement('a');
    signUp.href = '/register';
    signUp.setAttribute('data-link', '');
    signUp.textContent = 'Sign up';

    el.append(signIn, signUp);
  }
}

export function initAuthNav() {
  render();
  eventBus.on('state:change', render);
}
