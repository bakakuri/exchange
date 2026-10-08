// js/submissions/review-queue.js - behavior for the /submissions/review
// route: submissions against the signed-in user's own campaigns, read
// from /api/verification/to-review (public.completion_details filtered
// to campaign_creator_id = the caller, via RLS), with approve/reject
// actions. The actual decision logic - only the campaign creator or an
// admin may act, no re-reviewing a completion, review_notes required on
// rejection - all lives in review_task_verification() (015_functions.sql);
// this file just calls it and reflects the result.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';

import { statusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { refreshNavBadges } from '../core/nav-badges.js';
import { t, tn } from '../core/i18n.js';

function renderProof(c) {
  const parts = [];
  if (c.proof_url) {
    parts.push(createEl('a', { href: c.proof_url, target: '_blank', rel: 'noopener noreferrer' }, c.proof_url));
  }
  if (c.proof_text) {
    parts.push(createEl('p', { class: 'submission-card__proof-text' }, c.proof_text));
  }
  if (parts.length === 0) return null;
  return createEl('div', { class: 'submission-card__proof' }, parts);
}

function renderActions(c, card, onDecided) {
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const approveBtn = createEl('button', { type: 'button', class: 'btn btn--primary' }, t('Approve'));
  const rejectBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, t('Reject'));

  const notesField = createEl('textarea', { rows: '2', placeholder: t('Reason for rejection (required)') });
  const confirmRejectBtn = createEl('button', { type: 'button', class: 'btn btn--danger' }, t('Confirm rejection'));
  const cancelRejectBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, t('Cancel'));
  const rejectForm = createEl('div', { class: 'submission-card__reject-form', hidden: '' }, [
    notesField,
    createEl('div', { class: 'submission-card__reject-actions' }, [confirmRejectBtn, cancelRejectBtn]),
  ]);

  async function decide(decision, review_notes) {
    errorEl.hidden = true;
    approveBtn.disabled = true;
    confirmRejectBtn.disabled = true;
    try {
      await api.verification.review(c.id, { decision, review_notes });
      refreshNavBadges();
      onDecided();
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not record that decision.');
      errorEl.hidden = false;
      approveBtn.disabled = false;
      confirmRejectBtn.disabled = false;
    }
  }

  approveBtn.addEventListener('click', () => decide('approved'));
  rejectBtn.addEventListener('click', () => {
    rejectForm.hidden = false;
    rejectBtn.hidden = true;
    approveBtn.hidden = true;
  });
  cancelRejectBtn.addEventListener('click', () => {
    rejectForm.hidden = true;
    rejectBtn.hidden = false;
    approveBtn.hidden = false;
  });
  confirmRejectBtn.addEventListener('click', () => decide('rejected', notesField.value.trim()));

  return createEl('div', { class: 'submission-card__actions' }, [approveBtn, rejectBtn, rejectForm, errorEl]);
}

function renderList(listEl, completions, reload, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (completions.length === 0 && listEl.children.length === 0) {
    listEl.append(emptyState({
      iconId: 'i-clipboard-check',
      title: t('Nothing to review'),
      text: t('When someone completes a task from one of your campaigns, their proof appears here for you to approve or reject.'),
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

    const proof = renderProof(c);
    if (proof) children.push(proof);

    if (c.status === 'rejected' && c.review_notes) {
      children.push(createEl('p', { class: 'submission-card__notes' }, t('Your notes: {notes}', { notes: c.review_notes })));
    }

    const body = createEl('div', { class: 'submission-card__body' }, children);
    const card = createEl('li', { class: 'submission-card' }, [platformTile(c.platform, { size: 'sm' }), body]);

    if (c.status === 'pending') {
      body.append(renderActions(c, card, reload));
    }

    listEl.append(card);
  }
}

export async function init() {
  const listEl = qs('[data-review-list]');
  const loadMoreBtn = qs('#review-load-more');
  const errorEl = qs('#review-error');
  const statusSelect = qs('#filter-status');
  if (!listEl) return;

  let cursor = null;

  async function loadPage({ reset = false } = {}) {
    if (reset) cursor = null;
    errorEl.hidden = true;

    try {
      const { completions, next_cursor } = await api.verification.toReview({
        before: cursor,
        status: statusSelect.value || undefined,
      });
      renderList(listEl, completions, () => loadPage({ reset: true }), { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not load the review queue.');
      errorEl.hidden = false;
    }
  }

  statusSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
