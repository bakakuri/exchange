// js/submissions/review-queue.js - behavior for the /submissions/review
// route: submissions against the signed-in user's own campaigns, read
// from /api/verification/to-review (public.completion_details filtered
// to campaign_creator_id = the caller, via RLS), with approve/reject
// actions. The actual decision logic - only the campaign creator or an
// admin may act, no re-reviewing a completion, review_notes required on
// rejection - all lives in review_task_verification() (015_functions.sql);
// this file just calls it and reflects the result.
//
// Since 021: each proof shows who sent it - level, track record and the
// account they did it from - and an approved follow/like/... can be
// reported within 7 days if the member undid it; an admin decides.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';

import { statusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { refreshNavBadges } from '../core/nav-badges.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { renderProof, statusDetail, followUpForm, withinFollowUpWindow } from './proof-view.js';

// Visits can't be taken back, so only these can be reported as undone.
const UNDOABLE = (c) => !['visit', 'view', 'listen'].includes(c.task_type);

// "@dex · Level 3 · 12 approved · 1 rejected" - who sent the proof.
function doerLine(c) {
  if (!c.completer_username) return null;
  const stats = c.completer_stats;
  const parts = [
    createEl('a', { href: `/u/${encodeURIComponent(c.completer_username)}`, 'data-link': '', class: 'doer-line__name' },
      `@${c.completer_username}`),
    createEl('span', {}, t('Level {level}', { level: formatNumber(c.completer_level || 1) })),
  ];
  if (stats) {
    parts.push(createEl('span', {}, tn(stats.approved, '{n} approved', '{n} approved')));
    if (stats.rejected + stats.reversed > 0) {
      parts.push(createEl('span', {}, tn(stats.rejected + stats.reversed, '{n} rejected', '{n} rejected')));
    }
  }
  const line = createEl('p', { class: 'doer-line' }, [icon('i-user', { size: 14 }), ...parts]);
  if (stats && !stats.trusted) {
    line.append(createEl('span', { class: 'trust-badge trust-badge--poor' },
      [icon('i-shield-alert', { size: 12 }), t('Often rejected')]));
  }
  return line;
}

function undoForm(c, reload) {
  return followUpForm({
    iconId: 'i-undo-2',
    buttonLabel: t('Report undone action'),
    intro: t('Did they unfollow, unlike or delete it after being paid? An admin checks, and can return the reward to you. Once per proof, within 7 days.'),
    placeholder: t('What was undone, and when did you notice?'),
    sendLabel: t('Send report'),
    errorText: (err) => errorMessage(err, 'Could not send the report.'),
    onSend: async (message) => {
      await api.verification.reportUndone(c.id, message);
      reload();
    },
  });
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

    const doer = doerLine(c);
    if (doer) children.push(doer);
    const proof = renderProof(c);
    if (proof) children.push(proof);
    // The reviewer's reason first, then where an appeal stands.
    if (c.status === 'rejected' && c.review_notes) {
      children.push(createEl('p', { class: 'submission-card__notes' }, t('Your notes: {notes}', { notes: c.review_notes })));
    }
    const detail = statusDetail(c, { reviewer: true });
    if (detail) children.push(detail);


    const body = createEl('div', { class: 'submission-card__body' }, children);
    const card = createEl('li', { class: 'submission-card' }, [platformTile(c.platform, { size: 'sm' }), body]);

    if (c.status === 'pending') {
      body.append(renderActions(c, card, reload));
    } else if (c.status === 'approved' && UNDOABLE(c) && !c.undo_report_status && withinFollowUpWindow(c.reviewed_at)) {
      body.append(undoForm(c, reload));
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
