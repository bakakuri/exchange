// js/core/messages-poller.js
// Keeps messages live while a member is signed in, with one small request
// at a time (GET /api/messages/updates):
//   - the unread count on the Messages links ([data-messages-badge]) and
//     in the tab title, "(3) Exchange";
//   - a pop-up for each new message (shared/message-toast.js), except in
//     the chat that is open on screen;
//   - the open chat's changes (new and deleted messages, the other side's
//     "seen", presence), handed to the chat through focusConversation().
// It asks every 2.5 s while a chat is open, every 10 s otherwise, every
// 30 s while the tab is hidden, and backs off after errors.

import { store } from './state.js';
import { eventBus } from './events.js';
import { api } from '../shared/api.js';
import { showMessageToast } from '../shared/message-toast.js';
import { previewText, KIND_ICONS } from '../messages/format.js';
import { navigate } from './router.js';
import { t } from './i18n.js';

const FAST_MS = 2500;
const NORMAL_MS = 10_000;
const HIDDEN_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

let since = null; // the newest message seq already seen by this page
let unread = 0;
let focus = null; // { id, after, onChange }
let timer = null;
let running = false;
let failures = 0;

function setBadges(count) {
  document.querySelectorAll('[data-messages-badge]').forEach((el) => {
    el.hidden = !count;
    el.textContent = count > 99 ? '99+' : String(count);
    el.setAttribute('aria-label', t('{n} unread', { n: count }));
  });
  const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
  document.title = count ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}

function toast(message) {
  const sender = message.sender || {};
  showMessageToast({
    name: sender.display_name || sender.username || t('Member'),
    avatarUrl: sender.avatar_url,
    text: message.kind === 'text' ? message.body : previewText(message),
    iconId: message.kind === 'text' ? null : KIND_ICONS[message.kind],
    imageUrl: message.kind === 'image' ? message.attachment_url : null,
    onOpen: () => navigate(`/messages/${message.conversation_id}`),
  });
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

function nextDelay() {
  if (failures) return Math.min(NORMAL_MS * 2 ** failures, MAX_BACKOFF_MS);
  if (document.visibilityState !== 'visible') return HIDDEN_MS;
  return focus ? FAST_MS : NORMAL_MS;
}

async function tick() {
  if (!store.getState().user) return;
  if (running) return;
  running = true;
  const asked = focus;
  try {
    const result = await api.messages.updates({
      since: since ?? undefined,
      conversation: asked?.id,
      after: asked ? asked.after : undefined,
    });
    failures = 0;

    if (since !== null && Array.isArray(result.incoming)) {
      const looking = document.visibilityState === 'visible';
      for (const message of result.incoming) {
        if (looking && focus && message.conversation_id === focus.id) continue;
        if (looking) toast(message);
      }
    }
    since = Math.max(since ?? 0, Number(result.latest_seq) || 0);

    if (result.conversation && focus && asked && focus.id === asked.id) {
      focus.onChange(result.conversation);
    }

    const changed = unread !== result.unread;
    unread = Number(result.unread) || 0;
    setBadges(unread);
    eventBus.emit('messages:update', { unread, latestSeq: since, changed, incoming: result.incoming || [] });
  } catch {
    failures += 1;
  } finally {
    running = false;
    if (store.getState().user) schedule(nextDelay());
  }
}

/** Ask right away (after sending, opening a chat, the tab coming back). */
export function pollMessagesNow() {
  if (store.getState().user) schedule(0);
}

/**
 * The chat on screen: its changes after `after` go to onChange.
 * Returns a function that ends the focus (when the chat closes).
 */
export function focusConversation(id, after, onChange) {
  focus = { id, after, onChange };
  pollMessagesNow();
  return () => {
    if (focus?.id === id) focus = null;
  };
}

/** The open chat has seen changes up to this change_seq. */
export function setConversationCursor(id, after) {
  if (focus?.id === id) focus.after = Math.max(focus.after || 0, Number(after) || 0);
}

export function unreadCount() {
  return unread;
}

export function initMessagesPoller() {
  let hadUser = Boolean(store.getState().user);
  if (hadUser) schedule(800);

  eventBus.on('state:change', () => {
    const hasUser = Boolean(store.getState().user);
    if (hasUser && !hadUser) {
      since = null;
      failures = 0;
      schedule(0);
    }
    if (!hasUser && hadUser) {
      clearTimeout(timer);
      since = null;
      unread = 0;
      focus = null;
      setBadges(0);
    }
    hadUser = hasUser;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollMessagesNow();
  });

  // The router sets a fresh title on every page: put the count back.
  const titleObserver = new MutationObserver(() => {
    if (unread && !/^\(\d+\+?\)/.test(document.title)) setBadges(unread);
  });
  const title = document.querySelector('title');
  if (title) titleObserver.observe(title, { childList: true });
}
