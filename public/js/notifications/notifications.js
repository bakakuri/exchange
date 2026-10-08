// js/notifications/notifications.js - behavior for the /notifications
// route: the signed-in user's own notifications (GET /api/notifications),
// each one already carrying a human-readable title/body written in
// English by whichever database function created it (015_functions.sql).
// serverText() shows those in the active language; free text inside them
// (a reviewer's note, a cancellation reason) stays as the person wrote it.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { refreshNavBadges } from '../core/nav-badges.js';
import { timeAgo, fullDateTime } from '../shared/time.js';
import { t } from '../core/i18n.js';
import { serverText } from '../shared/server-text.js';

const NOTIFICATION_ICONS = {
  verification_approved: 'i-badge-check',
  verification_rejected: 'i-circle-alert',
  reward_received: 'i-coins',
  campaign_completed: 'i-megaphone',
  campaign_cancelled: 'i-megaphone',
  refund: 'i-repeat',
  achievement_unlocked: 'i-award',
  referral_reward: 'i-users',
  admin_message: 'i-shield',
  proof_submitted: 'i-clipboard-check',
  reward_reversed: 'i-undo-2',
};

// Notifications that ask for something get a way to do it.
const NOTIFICATION_ACTIONS = {
  proof_submitted: { href: '/submissions/review', label: () => t('Review proof') },
  verification_rejected: { href: '/submissions?status=rejected', label: () => t('See submission') },
};

function renderNotifications(listEl, notifications, onRead, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (notifications.length === 0 && listEl.children.length === 0) {
    listEl.append(emptyState({
      iconId: 'i-bell',
      title: t('You’re all caught up'),
      text: t('Approvals, rewards and campaign updates will show up here.'),
      className: 'notification-list__empty',
    }));
    return;
  }

  for (const n of notifications) {
    const children = [
      createEl('div', { class: 'notification-item__main' }, [
        createEl('strong', {}, serverText(n.title)),
        createEl('time', { class: 'notification-item__date', datetime: n.created_at, title: fullDateTime(n.created_at) }, timeAgo(n.created_at)),
      ]),
    ];
    if (n.body) children.push(createEl('p', { class: 'notification-item__body' }, serverText(n.body)));
    const action = NOTIFICATION_ACTIONS[n.type];
    if (action) {
      children.push(createEl('a', { href: action.href, 'data-link': '', class: 'notification-item__action' },
        [action.label(), icon('i-arrow-right', { size: 14 })]));
    }

    const body = createEl('div', { class: 'notification-item__content' }, children);
    const item = createEl('li', { class: `notification-item${n.read_at ? '' : ' notification-item--unread'}` }, [
      createEl('span', { class: 'row-icon' }, [icon(NOTIFICATION_ICONS[n.type] || 'i-bell', { size: 18 })]),
      body,
    ]);

    if (!n.read_at) {
      const readBtn = createEl('button', { type: 'button', class: 'btn btn--ghost notification-item__read-btn' }, t('Mark read'));
      readBtn.addEventListener('click', () => onRead(n.id, item, readBtn));
      body.append(readBtn);
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
      errorEl.textContent = errorMessage(err, 'Could not load notifications.');
      errorEl.hidden = false;
    }
  }

  async function handleRead(id, item, readBtn) {
    readBtn.disabled = true;
    try {
      await api.notifications.markRead(id);
      refreshNavBadges();
      item.classList.remove('notification-item--unread');
      readBtn.remove();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not mark that as read.');
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
      refreshNavBadges();
      await loadPage({ reset: true });
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not mark all as read.');
      errorEl.hidden = false;
    } finally {
      markAllBtn.disabled = false;
    }
  });

  await loadPage({ reset: true });
}
