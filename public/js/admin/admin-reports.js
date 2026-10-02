// js/admin/admin-reports.js — /admin/reports page behavior.
//
// Shows the admin list of reports filtered by status. Each open report
// has inline Resolve / Dismiss buttons that call POST /api/admin/reports/:id/resolve.

import { api } from '../shared/api.js';
import { qs, escapeHtml } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';

const TYPE_LABELS = {
  spam: 'Spam',
  fraud: 'Fraud',
  invalid_task: 'Invalid task',
  inappropriate_content: 'Inappropriate content',
  broken_url: 'Broken URL',
  abuse: 'Abuse',
};

// ── render ──────────────────────────────────────────────────────────────────

function renderReportRow(report, listEl) {
  const li = document.createElement('li');
  li.className = 'admin-report-row';
  li.dataset.id = report.id;

  const typeLabel = TYPE_LABELS[report.report_type] || report.report_type;
  const date = new Date(report.created_at).toLocaleDateString();
  const reporter = report.reporter
    ? `@${report.reporter.username || report.reporter_id}`
    : report.reporter_id;

  const targetParts = [];
  if (report.related_task_id) targetParts.push(`Task: ${report.related_task_id}`);
  if (report.related_campaign_id) targetParts.push(`Campaign: ${report.related_campaign_id}`);
  if (report.related_user_id) targetParts.push(`User: ${report.related_user_id}`);

  li.innerHTML = `
    <div class="admin-report-row__header">
      <span class="admin-report-type">${escapeHtml(typeLabel)}</span>
      <span class="admin-report-status admin-report-status--${escapeHtml(report.status)}">${escapeHtml(report.status)}</span>
      <span class="admin-report-row__date">${date}</span>
    </div>
    <p class="admin-report-row__reporter">Reporter: ${escapeHtml(reporter)}</p>
    ${targetParts.length ? `<p class="admin-report-row__target">${escapeHtml(targetParts.join(', '))}</p>` : ''}
    <p class="admin-report-row__description">${escapeHtml(report.description)}</p>
    ${report.status === 'open' ? `
      <div class="admin-report-row__actions">
        <button class="btn btn--sm btn--success" data-resolve="resolved">Resolve</button>
        <button class="btn btn--sm btn--danger" data-resolve="dismissed">Dismiss</button>
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
          statusEl.textContent = decision;
        }
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err instanceof ApiError ? err.message : 'Operation failed.';
          errorEl.hidden = false;
        }
        btn.disabled = false;
      }
    });
  });

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
    errorEl.textContent = err instanceof ApiError ? err.message : 'Failed to load reports.';
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
