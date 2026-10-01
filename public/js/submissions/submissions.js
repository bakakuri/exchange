// js/submissions/submissions.js - behavior for the /submissions route:
// the signed-in user's own submitted proof and its review outcome,
// read from /api/verification/mine (public.completion_details filtered
// to completer_id = the caller, via RLS - see 018_completion_details_view.sql).
// Read-only: acting on a submission (approving/rejecting) is the
// reviewer's job, on /submissions/review.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { taskPlatformLabel } from '../shared/task-platforms.js';
import { taskTypeLabel } from '../shared/task-types.js';
import { statusLabel } from './status.js';

function renderSubmissions(listEl, completions, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (completions.length === 0 && listEl.children.length === 0) {
    listEl.append(createEl('li', { class: 'submission-list__empty' }, 'No submissions yet.'));
    return;
  }

  for (const c of completions) {
    const children = [
      createEl('div', { class: 'submission-card__header' }, [
        createEl('strong', {}, c.campaign_title),
        createEl('span', { class: `submission-status submission-status--${c.status}` }, statusLabel(c.status)),
      ]),
      createEl('p', { class: 'submission-card__meta' }, `${taskPlatformLabel(c.platform)} · ${taskTypeLabel(c.task_type)} · ${c.reward_amount} credits`),
    ];

    if (c.status === 'rejected' && c.review_notes) {
      children.push(createEl('p', { class: 'submission-card__notes' }, `Reviewer notes: ${c.review_notes}`));
    }

    listEl.append(createEl('li', { class: 'submission-card' }, children));
  }
}

export async function init() {
  const listEl = qs('[data-submission-list]');
  const loadMoreBtn = qs('#submissions-load-more');
  const errorEl = qs('#submissions-error');
  const statusSelect = qs('#filter-status');
  if (!listEl) return;

  let cursor = null;

  async function loadPage({ reset = false } = {}) {
    if (reset) cursor = null;
    errorEl.hidden = true;

    try {
      const { completions, next_cursor } = await api.verification.mine({
        before: cursor,
        status: statusSelect.value || undefined,
      });
      renderSubmissions(listEl, completions, { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load submissions.';
      errorEl.hidden = false;
    }
  }

  statusSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
