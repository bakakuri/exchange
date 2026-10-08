// js/core/nav-badges.js
// Count badges in the navigation: unread notifications ([data-unread-badge])
// and submissions waiting for the signed-in member's review
// ([data-review-badge]). Refreshed after sign-in and on page changes, at
// most once every 20 seconds, so moving around stays cheap.

import { store } from './state.js';
import { eventBus } from './events.js';
import { api } from '../shared/api.js';
import { t } from './i18n.js';

const MIN_INTERVAL_MS = 20_000;
let lastRun = 0;
let running = false;

function setBadge(selector, count, { hasMore = false } = {}) {
  document.querySelectorAll(selector).forEach((el) => {
    el.hidden = !count;
    if (el.classList.contains('nav-badge--dot')) {
      el.textContent = '';
      el.setAttribute('aria-label', t('{n} new', { n: count }));
    } else {
      el.textContent = hasMore || count > 99 ? '99+' : String(count);
    }
  });
}

async function refresh({ force = false } = {}) {
  if (!store.getState().user) {
    setBadge('[data-unread-badge]', 0);
    setBadge('[data-review-badge]', 0);
    return;
  }
  if (running || (!force && Date.now() - lastRun < MIN_INTERVAL_MS)) return;
  running = true;
  lastRun = Date.now();
  try {
    const [unread, review] = await Promise.allSettled([
      api.notifications.unreadCount(),
      api.verification.toReview({ status: 'pending' }),
    ]);
    if (unread.status === 'fulfilled') setBadge('[data-unread-badge]', unread.value.unread_count || 0);
    if (review.status === 'fulfilled') {
      const { completions = [], next_cursor: more } = review.value;
      setBadge('[data-review-badge]', completions.length, { hasMore: Boolean(more) });
    }
  } finally {
    running = false;
  }
}

export function initNavBadges() {
  refresh({ force: true });

  let hadUser = Boolean(store.getState().user);
  eventBus.on('state:change', () => {
    const hasUser = Boolean(store.getState().user);
    if (hasUser !== hadUser) refresh({ force: true });
    hadUser = hasUser;
  });

  const root = document.getElementById('app-root');
  if (root) new MutationObserver(() => refresh()).observe(root, { childList: true });
}

// Pages that change counts (marking notifications read, reviewing a
// submission) can call this to update the badges straight away.
export function refreshNavBadges() {
  return refresh({ force: true });
}
