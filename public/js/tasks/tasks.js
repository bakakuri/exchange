// js/tasks/tasks.js - behavior for the /tasks route: browse open tasks,
// filterable by platform/type, "load more"-paginated.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { TASK_PLATFORMS, taskPlatformLabel } from '../shared/task-platforms.js';
import { TASK_TYPES, taskTypeLabel } from '../shared/task-types.js';

function renderTasks(listEl, tasks, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (tasks.length === 0 && listEl.children.length === 0) {
    listEl.append(createEl('li', { class: 'task-list__empty' }, 'No open tasks right now — check back soon.'));
    return;
  }

  for (const task of tasks) {
    listEl.append(
      createEl('li', { class: 'task-card' }, [
        createEl('a', { href: `/tasks/${task.id}`, 'data-link': '', class: 'task-card__link' }, [
          createEl('div', { class: 'task-card__header' }, [
            createEl('strong', {}, task.campaign_title),
            createEl('span', { class: 'task-card__reward' }, `${task.reward} credits`),
          ]),
          createEl('p', { class: 'task-card__meta' }, `${taskPlatformLabel(task.platform)} · ${taskTypeLabel(task.task_type)}`),
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
  for (const t of TASK_TYPES) taskTypeSelect.append(new Option(t.label, t.value));

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
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load tasks.';
      errorEl.hidden = false;
    }
  }

  platformSelect.addEventListener('change', () => loadPage({ reset: true }));
  taskTypeSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
