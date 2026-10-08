// js/submissions/submissions.js - behavior for the /submissions route:
// the signed-in user's own submitted proof and its review outcome,
// read from /api/verification/mine (public.completion_details filtered
// to completer_id = the caller, via RLS - see 018_completion_details_view.sql).
// Approving/rejecting is the reviewer's job, on /submissions/review; the
// one action here is an appeal of a rejection, within 7 days (021). The
// top of the page shows how many proofs may wait for review at once.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';

import { statusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { renderProof, statusDetail, followUpForm, withinFollowUpWindow } from './proof-view.js';

// "3 of 10 proofs waiting for review" - the limit grows with level.
function renderLimits(el, limits) {
  el.innerHTML = '';
  if (!limits || !limits.pending_limit) { el.hidden = true; return; }
  const full = limits.pending_count >= limits.pending_limit;
  const lines = [
    createEl('strong', {}, t('{count} of {limit} proofs waiting for review', {
      count: formatNumber(limits.pending_count), limit: formatNumber(limits.pending_limit),
    })),
    createEl('span', {}, full
      ? t('You’ve reached your limit - new proofs can be sent once some are reviewed.')
      : t('Level {level} allows {limit}; higher levels allow more, up to 30.', {
        level: formatNumber(limits.level), limit: formatNumber(limits.pending_limit),
      })),
  ];
  if (!limits.trusted) {
    lines.push(createEl('span', { class: 'submission-limits__warn' },
      t('Many of your proofs were rejected, so new ones aren’t approved automatically.')));
  }
  el.className = `submission-limits${full || !limits.trusted ? ' submission-limits--warn' : ''}`;
  el.append(icon(full ? 'i-hourglass' : 'i-layers', { size: 18 }), createEl('div', { class: 'submission-limits__text' }, lines));
  el.hidden = false;
}

function appealForm(c, reload) {
  return followUpForm({
    iconId: 'i-scale',
    buttonLabel: t('Appeal'),
    intro: t('Think the rejection is wrong? An admin will look at your proof. You can appeal once, within 7 days.'),
    placeholder: t('What did you do, and why is the proof enough?'),
    sendLabel: t('Send appeal'),
    errorText: (err) => errorMessage(err, 'Could not send the appeal.'),
    onSend: async (message) => {
      await api.verification.appeal(c.id, message);
      reload();
    },
  });
}

function renderSubmissions(listEl, completions, reload, { append = false } = {}) {
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

    const proof = renderProof(c);
    if (proof) children.push(proof);
    // The reviewer's reason first, then where an appeal stands.
    if (c.status === 'rejected' && c.review_notes) {
      children.push(createEl('p', { class: 'submission-card__notes' }, t('Reviewer notes: {notes}', { notes: c.review_notes })));
    }
    const detail = statusDetail(c);
    if (detail) children.push(detail);

    if (c.status === 'rejected' && !c.appeal_status && withinFollowUpWindow(c.reviewed_at)) {
      children.push(appealForm(c, reload));
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
  const limitsEl = qs('[data-submission-limits]');
  if (!listEl) return;

  // /submissions?status=rejected (from a notification) opens that filter.
  const wanted = new URLSearchParams(location.search).get('status');
  if (wanted && [...statusSelect.options].some((o) => o.value === wanted)) statusSelect.value = wanted;

  let cursor = null;

  async function loadPage({ reset = false } = {}) {
    if (reset) cursor = null;
    errorEl.hidden = true;

    try {
      const { completions, next_cursor, limits } = await api.verification.mine({
        before: cursor,
        status: statusSelect.value || undefined,
      });
      if (limitsEl && !cursor) renderLimits(limitsEl, limits);
      renderSubmissions(listEl, completions, () => loadPage({ reset: true }), { append: Boolean(cursor) });
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
