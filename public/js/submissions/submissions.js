// js/submissions/submissions.js - behavior for the /submissions route:
// the signed-in user's own submitted proof and its review outcome,
// read from /api/verification/mine (public.completion_details filtered
// to completer_id = the caller, via RLS - see 018_completion_details_view.sql).
// Read-only: acting on a submission (approving/rejecting) is the
// reviewer's job, on /submissions/review.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';

import { statusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { t, tn } from '../core/i18n.js';

function renderSubmissions(listEl, completions, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (completions.length === 0 && listEl.children.length === 0) {
    listEl.append(emptyState({
      iconId: 'i-inbox',
      title: t('No submissions yet'),
      text: t('When you complete a task and send proof, it shows up here until the campaign owner reviews it.'),
      action: { href: '/tasks', label: t('Find a task') },
      className: 'submission-list__empty',
    }));
    return;
  }

  for (const c of completions) {
    const children = [
      createEl('div', { class: 'submission-card__header' }, [
        createEl('strong', {}, c.campaign_title),
        createEl('span', { class: `submission-status submission-status--${c.status}` }, statusLabel(c.status)),
      ]),
      createEl('p', { class: 'submission-card__meta' }, `${taskActionLabel(c.task_type, c.platform)}, ${tn(c.reward_amount, '{n} credit', '{n} credits')}`),
    ];

    if (c.status === 'rejected' && c.review_notes) {
      children.push(createEl('p', { class: 'submission-card__notes' }, t('Reviewer notes: {notes}', { notes: c.review_notes })));
    }

    listEl.append(createEl('li', { class: 'submission-card' }, [
      platformTile(c.platform, { size: 'sm' }),
      createEl('div', { class: 'submission-card__body' }, children),
    ]));
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
      errorEl.textContent = errorMessage(err, 'Could not load submissions.');
      errorEl.hidden = false;
    }
  }

  statusSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
