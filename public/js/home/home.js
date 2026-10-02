// js/home/home.js
// Behavior for the "/" route. pages/home.html holds both views; this shows
// the visitor explainer or the signed-in dashboard and fills in the live
// parts. Everything user-supplied goes through createEl() (textContent),
// never innerHTML.

import { store } from '../core/state.js';
import { api } from '../shared/api.js';
import { qs, qsa, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { TASK_PLATFORMS } from '../shared/task-platforms.js';
import { taskActionLabel } from '../shared/task-label.js';

const DASHBOARD_TASKS = 5;

function showView(name) {
  qsa('[data-home-visitor]').forEach((el) => { el.hidden = name !== 'visitor'; });
  qsa('[data-home-member]').forEach((el) => { el.hidden = name !== 'member'; });
}

// ── Visitor ────────────────────────────────────────────────────────────

function renderVisitor() {
  showView('visitor');
  const list = qs('[data-home-platforms]');
  if (!list || list.children.length) return;
  for (const p of TASK_PLATFORMS) {
    if (p.value === 'other') continue;
    list.append(createEl('li', { class: 'platform-list__item' }, p.label));
  }
}

// ── Signed in ──────────────────────────────────────────────────────────

const setText = (sel, text) => {
  const el = qs(sel);
  if (el) el.textContent = text;
};

function renderTasks(listEl, tasks) {
  listEl.innerHTML = '';
  if (!tasks.length) {
    listEl.append(
      createEl('li', { class: 'home-task-list__empty' }, [
        'No open tasks right now. ',
        createEl('a', { href: '/campaigns/new', 'data-link': '' }, 'Start a campaign'),
        ' so others can find your page.',
      ])
    );
    return;
  }
  for (const task of tasks.slice(0, DASHBOARD_TASKS)) {
    listEl.append(
      createEl('li', {}, [
        createEl('a', { class: 'home-task', href: `/tasks/${task.id}`, 'data-link': '' }, [
          createEl('span', { class: 'home-task__main' }, [
            createEl('span', { class: 'home-task__title' }, task.campaign_title),
            createEl('span', { class: 'home-task__action' }, taskActionLabel(task.task_type, task.platform)),
          ]),
          createEl('span', { class: 'home-task__reward' }, `+${task.reward}`),
        ]),
      ])
    );
  }
}

async function renderMember(user) {
  showView('member');
  setText('[data-home-greeting]', `Welcome back, ${user.display_name || user.username || 'there'}`);
  setText('[data-home-credits]', String(user.credits ?? 0));
  setText('[data-home-level]', String(user.level ?? 1));
  setText('[data-home-xp]', `${user.xp ?? 0} XP`);

  const listEl = qs('[data-home-tasks]');
  const errorEl = qs('[data-home-error]');

  const [balance, unread, tasks] = await Promise.allSettled([
    api.credits.balance(),
    api.notifications.unreadCount(),
    api.tasks.listOpen(),
  ]);

  if (balance.status === 'fulfilled') setText('[data-home-credits]', String(balance.value.credits));
  setText('[data-home-unread]', unread.status === 'fulfilled' ? String(unread.value.unread_count) : '–');

  if (tasks.status === 'fulfilled') {
    renderTasks(listEl, tasks.value.tasks || []);
  } else if (errorEl) {
    errorEl.textContent = tasks.reason instanceof ApiError
      ? tasks.reason.message
      : 'Could not load open tasks. Refresh to try again.';
    errorEl.hidden = false;
  }
}

export function init() {
  if (!qs('[data-home]')) return;
  const user = store.getState().user;
  if (user) renderMember(user);
  else renderVisitor();
}
