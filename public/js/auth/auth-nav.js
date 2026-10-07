// js/auth/auth-nav.js
// Keeps the app shell in sync with sign-in state. On every store change:
//   - <html data-auth="in|out"> switches the shell between the visitor
//     top bar and the member sidebar / tab bar (css/layout.css);
//   - every [data-credits] shows the cached balance;
//   - [data-admin-only] links appear only for admins (presentation only -
//     the server and route guards enforce access);
//   - #auth-nav (sidebar footer) renders the user row: avatar, name,
//     profile link, theme switch and sign out.
// The store is the single source of truth (auth.js writes it).

import { store } from '../core/state.js';
import { eventBus } from '../core/events.js';
import { logout } from './auth.js';
import { qs, qsa, createEl } from '../shared/dom.js';
import { icon, avatar } from '../shared/icons.js';
import { currentTheme } from '../core/theme.js';

function renderUserRow(el, user) {
  el.innerHTML = '';
  if (!user) return;

  const name = user.display_name || user.username || user.email;

  const themeToggle = createEl('button', {
    type: 'button',
    class: 'icon-button theme-toggle',
    'data-theme-toggle': '',
    'aria-label': currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  }, [
    icon('i-sun', { size: 18, className: 'theme-toggle__sun' }),
    icon('i-moon', { size: 18, className: 'theme-toggle__moon' }),
  ]);

  const signOut = createEl('button', { type: 'button', class: 'icon-button', 'aria-label': 'Sign out', title: 'Sign out' },
    [icon('i-log-out', { size: 18 })]);
  signOut.addEventListener('click', () => logout());

  el.append(
    createEl('a', { class: 'user-row__profile', href: '/profile', 'data-link': '' }, [
      avatar(name),
      createEl('span', { class: 'user-row__text' }, [
        createEl('span', { class: 'user-row__name' }, name),
        createEl('span', { class: 'user-row__handle' }, `@${user.username || ''}`),
      ]),
    ]),
    createEl('span', { class: 'user-row__actions' }, [themeToggle, signOut]),
  );
}

function render() {
  const user = store.getState().user;
  document.documentElement.setAttribute('data-auth', user ? 'in' : 'out');

  qsa('[data-credits]').forEach((el) => { el.textContent = user ? String(user.credits ?? 0) : '0'; });
  qsa('[data-admin-only]').forEach((el) => { el.hidden = user?.role !== 'admin'; });

  const slot = qs('#auth-nav');
  if (slot) renderUserRow(slot, user);
}

export function initAuthNav() {
  render();
  eventBus.on('state:change', render);
}
