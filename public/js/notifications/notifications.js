// js/notifications/notifications.js - behavior for the /notifications
// route: the signed-in user's own notifications (GET /api/notifications),
// each one already carrying a human-readable title/body written by
// whichever database function created it (015_functions.sql) - nothing
// here needs its own type-to-label mapping the way credits.js or
// submissions/status.js do, since a notification's title already is its
// label.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';

function renderNotifications(listEl, notifications, onRead, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (notifications.length === 0 && listEl.children.length === 0) {
    listEl.append(createEl('li', { class: 'notification-list__empty' }, 'No notifications yet.'));
    return;
  }

  for (const n of notifications) {
    const children = [
      createEl('div', { class: 'notification-item__main' }, [
        createEl('strong', {}, n.title),
        createEl('time', { class: 'notification-item__date' }, new Date(n.created_at).toLocaleString()),
      ]),
    ];
    if (n.body) children.push(createEl('p', { class: 'notification-item__body' }, n.body));

    const item = createEl('li', { class: `notification-item${n.read_at ? '' : ' notification-item--unread'}` }, children);

    if (!n.read_at) {
      const readBtn = createEl('button', { type: 'button', class: 'btn btn--ghost notification-item__read-btn' }, 'Mark read');
      readBtn.addEventListener('click', () => onRead(n.id, item, readBtn));
      item.append(readBtn);
    }

    listEl.append(item);
  }
}

export async function init() {
  const listEl = qs('[data-notification-list]');
  const loadMoreBtn = qs('#notifications-load-more');
  const errorEl = qs('#notifications-error');
  const unreadToggle = qs('#filter-unread');
  const markAllBtn = qs('#mark-all-read-btn');
  if (!listEl) return;

  let cursor = null;

  async function loadPage({ reset = false } = {}) {
    if (reset) cursor = null;
    errorEl.hidden = true;

    try {
      const { notifications, next_cursor } = await api.notifications.mine({
        before: cursor,
        unread: unreadToggle.checked,
      });
      renderNotifications(listEl, notifications, handleRead, { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load notifications.';
      errorEl.hidden = false;
    }
  }

  async function handleRead(id, item, readBtn) {
    readBtn.disabled = true;
    try {
      await api.notifications.markRead(id);
      item.classList.remove('notification-item--unread');
      readBtn.remove();
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not mark that as read.';
      errorEl.hidden = false;
      readBtn.disabled = false;
    }
  }

  unreadToggle.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());
  markAllBtn.addEventListener('click', async () => {
    markAllBtn.disabled = true;
    try {
      await api.notifications.markAllRead();
      await loadPage({ reset: true });
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not mark all as read.';
      errorEl.hidden = false;
    } finally {
      markAllBtn.disabled = false;
    }
  });

  await loadPage({ reset: true });
}
