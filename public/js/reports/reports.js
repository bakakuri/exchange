// js/reports/reports.js — /reports page behavior.
//
// Two sections:
//  1. Submit form — picks category + target type + target id + description,
//     posts to /api/reports and shows confirmation.
//  2. History list — cursor-paginated list of the caller's own reports.

import { api } from '../shared/api.js';
import { qs } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';

// ── submit form ─────────────────────────────────────────────────────────────

const TARGET_HINTS = {
  task: 'Find the ID in the task URL: /tasks/<id>',
  campaign: 'Find the ID in the campaign URL: /campaigns/<id>',
  user: "Find the user's profile URL: /u/<username> (use their profile UUID)",
};

function initSubmitForm() {
  const form = qs('#report-form');
  const errorEl = qs('#report-error');
  const successEl = qs('#report-success');
  const targetTypeEl = qs('#report-target-type');
  const hintEl = qs('#report-target-hint');

  if (!form) return;

  // Update hint text when target type changes.
  if (targetTypeEl && hintEl) {
    targetTypeEl.addEventListener('change', () => {
      hintEl.textContent = TARGET_HINTS[targetTypeEl.value] || '';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const targetType = form.target_type?.value;
    const targetId = form.target_id?.value?.trim();

    // Build body — only include the matching related_* field.
    const body = {
      report_type: form.report_type.value,
      description: form.description.value.trim(),
    };
    if (targetType === 'task') body.related_task_id = targetId;
    else if (targetType === 'campaign') body.related_campaign_id = targetId;
    else if (targetType === 'user') body.related_user_id = targetId;

    try {
      await api.reports.submit(body);
      successEl.hidden = false;
      form.reset();
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Submission failed.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── history list ────────────────────────────────────────────────────────────

const STATUS_LABELS = { open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed' };
const TYPE_LABELS = {
  spam: 'Spam',
  fraud: 'Fraud',
  invalid_task: 'Invalid task',
  inappropriate_content: 'Inappropriate content',
  broken_url: 'Broken URL',
  abuse: 'Abuse',
};

function renderReportItem(report) {
  const li = document.createElement('li');
  li.className = 'report-item';

  const statusClass = `report-item__status--${report.status}`;
  const date = new Date(report.created_at).toLocaleDateString();
  const typeLabel = TYPE_LABELS[report.report_type] || report.report_type;
  const statusLabel = STATUS_LABELS[report.status] || report.status;

  li.innerHTML = `
    <div class="report-item__header">
      <span class="report-item__type">${typeLabel}</span>
      <span class="report-item__status ${statusClass}">${statusLabel}</span>
    </div>
    <p class="report-item__description">${report.description}</p>
    <p class="report-item__date">${date}</p>
  `.trim();

  return li;
}

let currentCursor = null;

async function loadMore(listEl, emptyEl, loadMoreBtn, errorEl) {
  loadMoreBtn.disabled = true;
  errorEl.hidden = true;

  try {
    const params = {};
    if (currentCursor) params.before = currentCursor;
    const { reports, hasMore, cursor } = await api.reports.mine(params);

    if (reports.length === 0 && !currentCursor) {
      emptyEl.hidden = false;
    } else {
      reports.forEach((r) => listEl.appendChild(renderReportItem(r)));
      currentCursor = cursor || null;
      loadMoreBtn.hidden = !hasMore;
    }
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? err.message : 'Failed to load reports.';
    errorEl.hidden = false;
  } finally {
    loadMoreBtn.disabled = false;
  }
}

// ── init ────────────────────────────────────────────────────────────────────

export async function init() {
  initSubmitForm();

  const listEl = qs('[data-report-list]');
  const emptyEl = qs('[data-report-empty]');
  const loadMoreBtn = qs('[data-report-load-more]');
  const errorEl = qs('#report-list-error');

  if (!listEl) return;

  await loadMore(listEl, emptyEl, loadMoreBtn, errorEl);

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () =>
      loadMore(listEl, emptyEl, loadMoreBtn, errorEl)
    );
  }
}
