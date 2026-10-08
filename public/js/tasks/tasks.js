// js/tasks/tasks.js - behavior for the /tasks route: browse open tasks,
// filterable by platform/type, "load more"-paginated.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { TASK_PLATFORMS } from '../shared/task-platforms.js';
import { TASK_TYPES } from '../shared/task-types.js';
import { taskActionLabel } from '../shared/task-label.js';
import { icon, platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { trustBadge, instantBadge } from '../shared/creator-trust.js';

function renderTasks(listEl, tasks, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (tasks.length === 0 && listEl.children.length === 0) {
    listEl.append(emptyState({
      iconId: 'i-list-checks',
      title: t('No open tasks right now'),
      text: t('New tasks appear here as soon as someone launches a campaign. Try another platform or type, or start a campaign of your own.'),
      action: { href: '/campaigns/new', label: t('Start a campaign') },
      className: 'task-list__empty',
    }));
    return;
  }

  for (const task of tasks) {
    listEl.append(
      createEl('li', { class: 'task-card' }, [
        createEl('a', { href: `/tasks/${task.id}`, 'data-link': '', class: 'task-card__link' }, [
          platformTile(task.platform),
          createEl('span', { class: 'task-card__body' }, [
            createEl('strong', { class: 'task-card__title' }, task.campaign_title),
            createEl('span', { class: 'task-card__meta' }, [
              createEl('span', {}, taskActionLabel(task.task_type, task.platform)),
              task.verification_method === 'link_click' ? instantBadge() : trustBadge(task.creator_stats),
            ]),
          ]),
          createEl('span', { class: 'reward-chip', title: tn(task.reward, '{n} credit', '{n} credits') }, `+${formatNumber(task.reward)}`),
          icon('i-chevron-right', { size: 16, className: 'row-chevron' }),
        ]),
      ])
    );
  }
}

export async function init() {
  const listEl = qs('[data-task-list]');
  const loadMoreBtn = qs('#tasks-load-more');
  const errorEl = qs('#tasks-error');
  const platformSelect = qs('#filter-platform');
  const taskTypeSelect = qs('#filter-task-type');
  if (!listEl) return;

  for (const p of TASK_PLATFORMS) platformSelect.append(new Option(p.label, p.value));
  for (const type of TASK_TYPES) taskTypeSelect.append(new Option(type.label, type.value));

  let cursor = null;

  async function loadPage({ reset = false } = {}) {
    if (reset) cursor = null;
    errorEl.hidden = true;

    try {
      const { tasks, next_cursor } = await api.tasks.listOpen({
        before: cursor,
        platform: platformSelect.value || undefined,
        taskType: taskTypeSelect.value || undefined,
      });
      renderTasks(listEl, tasks, { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not load tasks.');
      errorEl.hidden = false;
    }
  }

  platformSelect.addEventListener('change', () => loadPage({ reset: true }));
  taskTypeSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
