// js/home/home.js
// Behavior for the "/" route. The fragment (pages/home.html) is the same
// static shell for everyone; this fills in the part that depends on
// whether the visitor is signed in, using the shared DOM helpers (not
// innerHTML) so a username can never be interpreted as markup.

import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';

export function init() {
  const actions = qs('[data-home-actions]');
  if (!actions) return;

  const user = store.getState().user;
  actions.innerHTML = '';

  if (user) {
    actions.append(
      createEl('p', {}, ['Welcome back, ', createEl('strong', {}, user.username || user.email), '.'])
    );
  } else {
    actions.append(
      createEl('div', { class: 'home-hero__actions' }, [
        createEl('a', { href: '/register', 'data-link': '' }, 'Create account'),
        createEl('a', { href: '/login', 'data-link': '' }, 'Sign in'),
      ])
    );
  }
}
