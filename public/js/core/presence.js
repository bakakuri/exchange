// js/core/presence.js
// Keeps a signed-in member's "online" status fresh while the page is open
// and visible: a ping every two minutes, and one when the tab comes back.
// Any API call counts too (requireAuth records it), so this only matters
// for someone reading a page without clicking anything.

import { store } from './state.js';
import { api } from '../shared/api.js';

const EVERY_MS = 2 * 60 * 1000;
let lastPing = 0;

function ping() {
  if (!store.getState().user || document.visibilityState !== 'visible') return;
  if (Date.now() - lastPing < EVERY_MS - 5000) return;
  lastPing = Date.now();
  api.presence.ping().catch(() => {});
}

export function initPresence() {
  setInterval(ping, EVERY_MS);
  document.addEventListener('visibilitychange', ping);
}
