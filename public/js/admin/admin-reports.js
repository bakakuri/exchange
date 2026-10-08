// js/admin/admin-reports.js — /admin/reports page behavior.
//
// Shows the admin list of reports filtered by status. Each open report
// has inline Resolve / Dismiss buttons that call POST /api/admin/reports/:id/resolve.
//
// Appeals and undone-action reports (021_trust_and_economy.sql) are about
// one proof: it is shown with the report, and the decision acts on it -
// approve and pay a rejected proof, or take a reward back to the creator.

import { api } from '../shared/api.js';
import { qs, escapeHtml, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { t, tn } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';
import { reportTypeLabel, reportStatusLabel } from '../shared/report-labels.js';
import { taskActionLabel } from '../shared/task-label.js';
import { statusLabel } from '../submissions/status.js';
import { renderProof } from '../submissions/proof-view.js';

const PROOF_REPORTS = ['proof_appeal', 'unfollowed'];

function setStatus(li, decision) {
  const statusEl = li.querySelector('.admin-report-status');
  if (statusEl) {
    statusEl.className = `admin-report-status admin-report-status--${decision}`;
    statusEl.textContent = reportStatusLabel(decision);
  }
}

// The proof the report is about: campaign, who sent it, the proof itself
// and the creator's reason for rejecting it.
function proofPanel(c) {
  const children = [
    createEl('div', { class: 'admin-proof__head' }, [
      createEl('strong', {}, c.campaign_title),
      createEl('span', { class: `submission-status submission-status--${c.status}` }, statusLabel(c.status)),
    ]),
    createEl('p', { class: 'admin-proof__meta' }, [
      `${taskActionLabel(c.task_type, c.platform)}, ${tn(c.reward_amount, '{n} credit', '{n} credits')} · `,
      c.completer_username
        ? createEl('a', { href: `/admin/users/${encodeURIComponent(c.completer_id)}`, 'data-link': '' }, `@${c.completer_username}`)
        : '',
    ]),
  ];
  const proof = renderProof(c);
  if (proof) children.push(proof);
  if (c.review_notes) {
    children.push(createEl('p', { class: 'submission-card__notes' }, t('Creator’s reason: {notes}', { notes: c.review_notes })));
  }
  return createEl('div', { class: 'admin-proof' }, children);
}

// Decide an appeal (approve and pay / keep the rejection) or an
// undone-action report (take the reward back / keep it).
function proofActions(report, li) {
  const c = report.completion;
  const appeal = report.report_type === 'proof_appeal';
  const note = createEl('textarea', { rows: '2', maxlength: '1000',
    placeholder: appeal ? t('Note (optional) - sent to the member if you keep the rejection')
      : t('Note (optional) - sent to the creator if you keep the reward') });
  const yesBtn = createEl('button', { type: 'button', class: `btn btn--sm ${appeal ? 'btn--success' : 'btn--danger'}` },
    [icon(appeal ? 'i-circle-check' : 'i-undo-2', { size: 16 }), appeal ? t('Approve and pay') : t('Take reward back')]);
  const noBtn = createEl('button', { type: 'button', class: 'btn btn--sm btn--ghost' },
    appeal ? t('Keep rejection') : t('Keep reward'));
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const done = createEl('p', { class: 'form-success', role: 'status', hidden: '' }, '');
  const box = createEl('div', { class: 'admin-report-row__actions admin-report-row__actions--proof' },
    [note, createEl('div', { class: 'admin-proof__buttons' }, [yesBtn, noBtn]), errorEl, done]);

  async function act(run, decision, message) {
    errorEl.hidden = true;
    yesBtn.disabled = true;
    noBtn.disabled = true;
    try {
      const result = await run();
      setStatus(li, decision);
      note.remove();
      yesBtn.parentElement.remove();
      done.textContent = message(result);
      done.hidden = false;
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Operation failed.');
      errorEl.hidden = false;
      yesBtn.disabled = false;
      noBtn.disabled = false;
    }
  }

  yesBtn.addEventListener('click', () => (appeal
    ? act(() => api.admin.overturnRejection(c.id, note.value.trim()), 'resolved',
      () => t('Approved - the member was paid.'))
    : act(() => api.admin.reverseReward(c.id, note.value.trim()), 'resolved',
      (r) => tn(r?.taken_back ?? 0, '{n} credit returned to the creator.', '{n} credits returned to the creator.'))));
  noBtn.addEventListener('click', () => act(
    () => api.admin.resolveReport(report.id, { decision: 'dismissed', note: note.value.trim() }), 'dismissed',
    () => (appeal ? t('Rejection kept - the member was told.') : t('Reward kept - the creator was told.'))));

  return box;
}

// ── render ──────────────────────────────────────────────────────────────────

function renderReportRow(report, listEl) {
  const li = document.createElement('li');
  li.className = 'admin-report-row';
  li.dataset.id = report.id;

  const typeLabel = reportTypeLabel(report.report_type);
  const date = shortDate(report.created_at);
  const reporter = report.reporter
    ? `@${report.reporter.username || report.reporter_id}`
    : report.reporter_id;

  const targetParts = [];
  if (report.related_task_id) targetParts.push(t('Task: {id}', { id: report.related_task_id }));
  if (report.related_campaign_id) targetParts.push(t('Campaign: {id}', { id: report.related_campaign_id }));
  if (report.related_user_id) targetParts.push(t('User: {id}', { id: report.related_user_id }));

  li.innerHTML = `
    <div class="admin-report-row__header">
      <span class="admin-report-type">${escapeHtml(typeLabel)}</span>
      <span class="admin-report-status admin-report-status--${escapeHtml(report.status)}">${escapeHtml(reportStatusLabel(report.status))}</span>
      <span class="admin-report-row__date">${date}</span>
    </div>
    <p class="admin-report-row__reporter">${escapeHtml(t('Reporter: {name}', { name: reporter }))}</p>
    ${targetParts.length ? `<p class="admin-report-row__target">${escapeHtml(targetParts.join(', '))}</p>` : ''}
    <p class="admin-report-row__description">${escapeHtml(report.description)}</p>
    ${report.status === 'open' && !(PROOF_REPORTS.includes(report.report_type) && report.completion) ? `
      <div class="admin-report-row__actions">
        <button class="btn btn--sm btn--success" data-resolve="resolved">${escapeHtml(t('Resolve'))}</button>
        <button class="btn btn--sm btn--danger" data-resolve="dismissed">${escapeHtml(t('Dismiss'))}</button>
        <p class="form-error admin-report-row__error" role="alert" hidden></p>
      </div>
    ` : ''}
  `.trim();

  // Wire resolve / dismiss buttons.
  li.querySelectorAll('[data-resolve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const decision = btn.dataset.resolve;
      const errorEl = li.querySelector('.admin-report-row__error');
      btn.disabled = true;

      try {
        await api.admin.resolveReport(report.id, { decision });
        // Remove the actions section and update the status badge inline.
        const actionsEl = li.querySelector('.admin-report-row__actions');
        if (actionsEl) actionsEl.remove();
        const statusEl = li.querySelector('.admin-report-status');
        if (statusEl) {
          statusEl.className = `admin-report-status admin-report-status--${decision}`;
          statusEl.textContent = reportStatusLabel(decision);
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = errorMessage(err, 'Operation failed.');
          errorEl.hidden = false;
        }
        btn.disabled = false;
      }
    });
  });

  if (PROOF_REPORTS.includes(report.report_type) && report.completion) {
    li.classList.add('admin-report-row--proof');
    li.append(proofPanel(report.completion));
    if (report.status === 'open') li.append(proofActions(report, li));
  }

  listEl.appendChild(li);
}

// ── pagination ───────────────────────────────────────────────────────────────

let currentStatus = 'open';
let currentCursor = null;

async function loadReports(listEl, emptyEl, loadMoreBtn, errorEl, reset = false) {
  if (reset) {
    currentCursor = null;
    listEl.innerHTML = '';
  }

  loadMoreBtn.hidden = true;
  errorEl.hidden = true;

  try {
    const params = { status: currentStatus };
    if (currentCursor) params.before = currentCursor;
    const { reports, next_cursor } = await api.admin.reports(params);

    if (reports.length === 0 && !currentCursor) {
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
      reports.forEach((r) => renderReportRow(r, listEl));
      currentCursor = next_cursor || null;
      loadMoreBtn.hidden = !next_cursor;
    }
  } catch (err) {
    errorEl.textContent = errorMessage(err, 'Failed to load reports.');
    errorEl.hidden = false;
  }
}

// ── init ────────────────────────────────────────────────────────────────────

export async function init() {
  const listEl = qs('[data-admin-report-list]');
  const emptyEl = qs('[data-admin-reports-empty]');
  const loadingEl = qs('[data-admin-reports-loading]');
  const loadMoreBtn = qs('[data-admin-reports-load-more]');
  const errorEl = qs('#admin-reports-error');
  const statusSelect = qs('[data-admin-reports-status]');

  if (!listEl) return;
  if (loadingEl) loadingEl.hidden = true;

  await loadReports(listEl, emptyEl, loadMoreBtn, errorEl, true);

  // Status filter
  if (statusSelect) {
    statusSelect.addEventListener('change', () => {
      currentStatus = statusSelect.value;
      loadReports(listEl, emptyEl, loadMoreBtn, errorEl, true);
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () =>
      loadReports(listEl, emptyEl, loadMoreBtn, errorEl, false)
    );
  }
}
