// js/admin/admin-submissions.js - /admin/submissions (022).
// Every proof members have sent, across all campaigns: waiting ones first
// by default, filterable by status and searchable by campaign, member or
// the account used. An admin can:
//   - approve or reject a waiting proof (review_task_verification()
//     accepts admins as well as the campaign's creator);
//   - approve a rejected one on appeal (admin_overturn_rejection());
//   - take back the reward of an approved one whose action was undone
//     (admin_reverse_reward()).

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon, platformTile, avatar } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { renderProof, statusDetail } from '../submissions/proof-view.js';
import { statusLabel } from '../submissions/status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { shortDateTime } from '../shared/time.js';
import { t, tn } from '../core/i18n.js';
import { mountAdminTabs } from './admin-tabs.js';

function person(id, username, url, label) {
  if (!username) return createEl('span', {}, '—');
  return createEl('a', { class: 'admin-person', href: `/admin/users/${id}`, 'data-link': '', title: label }, [
    avatar(username, { size: 'sm', url }), `@${username}`,
  ]);
}

function noteForm({ placeholder, submitLabel, danger = false, required = false, onSubmit }) {
  const textarea = createEl('textarea', { rows: '2', maxlength: '1000', placeholder, 'aria-label': placeholder });
  const submit = createEl('button', { type: 'submit', class: `btn btn--sm ${danger ? 'btn--danger' : 'btn--primary'}` }, submitLabel);
  const back = createEl('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, t('Back'));
  const error = createEl('p', { class: 'form-error', role: 'alert' });
  error.hidden = true;
  const form = createEl('form', { class: 'admin-inline-form', novalidate: '' }, [
    textarea, error, createEl('div', { class: 'admin-inline-form__actions' }, [submit, back]),
  ]);
  back.addEventListener('click', () => form.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = textarea.value.trim();
    if (required && !note) {
      error.textContent = t('Write a short note for the member.');
      error.hidden = false;
      textarea.focus();
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(note);
    } catch (err) {
      error.textContent = errorMessage(err, 'That did not work. Please try again.');
      error.hidden = false;
      submit.disabled = false;
    }
  });
  requestAnimationFrame(() => textarea.focus());
  return form;
}

function submissionRow(c, reload) {
  const actions = createEl('div', { class: 'admin-row__actions' });
  const row = createEl('li', { class: 'admin-row' }, [
    createEl('div', { class: 'admin-row__main' }, [
      platformTile(c.platform || 'other'),
      createEl('div', { class: 'admin-row__text' }, [
        createEl('p', { class: 'admin-row__title' }, c.campaign_title),
        createEl('p', { class: 'admin-row__meta' }, [
          createEl('span', {}, taskActionLabel(c.task_type, c.platform)),
          createEl('span', {}, tn(c.reward_amount, '{n} credit', '{n} credits')),
          createEl('span', {}, shortDateTime(c.created_at)),
        ]),
        createEl('p', { class: 'admin-row__meta admin-row__people' }, [
          createEl('span', { class: 'admin-row__label' }, t('Doer')),
          person(c.completer_id, c.completer_username, null, t('Doer')),
          createEl('span', { class: 'admin-row__label' }, t('Creator')),
          person(c.campaign_creator_id, c.creator?.username, c.creator?.avatar_url, t('Creator')),
        ]),
      ]),
      createEl('span', { class: `submission-status submission-status--${c.status}` }, statusLabel(c.status)),
    ]),
  ]);

  const proof = renderProof(c);
  if (proof) row.append(proof);
  const detail = statusDetail(c, { reviewer: true });
  if (detail) row.append(detail);
  if (c.review_notes) {
    row.append(createEl('p', { class: 'admin-row__note' }, [icon('i-message-square', { size: 14 }), c.review_notes]));
  }

  const add = (iconId, label, className, makeForm) => {
    const btn = createEl('button', { type: 'button', class: `btn btn--sm ${className}`.trim() }, [icon(iconId, { size: 16 }), label]);
    btn.addEventListener('click', () => {
      row.querySelector('.admin-inline-form')?.remove();
      row.append(makeForm());
    });
    actions.append(btn);
  };

  if (c.status === 'pending') {
    const approve = createEl('button', { type: 'button', class: 'btn btn--sm btn--success' }, [icon('i-check', { size: 16 }), t('Approve')]);
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        await api.admin.reviewCompletion(c.id, { decision: 'approved' });
        reload();
      } catch (err) {
        approve.disabled = false;
        row.append(createEl('p', { class: 'form-error', role: 'alert' }, errorMessage(err, 'Could not approve this proof.')));
      }
    });
    actions.append(approve);
    add('i-x', t('Reject'), 'btn--danger', () => noteForm({
      placeholder: t('Why is it rejected? The member sees this.'),
      submitLabel: t('Reject'),
      danger: true,
      required: true,
      onSubmit: async (note) => { await api.admin.reviewCompletion(c.id, { decision: 'rejected', review_notes: note }); reload(); },
    }));
  } else if (c.status === 'rejected') {
    add('i-scale', t('Approve on appeal'), '', () => noteForm({
      placeholder: t('Note for both sides (optional)'),
      submitLabel: t('Approve and pay'),
      onSubmit: async (note) => { await api.admin.overturnRejection(c.id, note || undefined); reload(); },
    }));
  } else if (c.status === 'approved') {
    add('i-undo-2', t('Take the reward back'), 'btn--danger', () => noteForm({
      placeholder: t('Why? Both sides see this (optional).'),
      submitLabel: t('Take the reward back'),
      danger: true,
      onSubmit: async (note) => { await api.admin.reverseReward(c.id, note || undefined); reload(); },
    }));
  }
  if (actions.childNodes.length) row.append(actions);
  return row;
}

export async function init() {
  mountAdminTabs();
  const listEl = qs('[data-admin-list]');
  const errorEl = qs('[data-admin-error]');
  const moreBtn = qs('[data-admin-more]');
  const searchEl = qs('[data-admin-search]');
  const statusEl = qs('[data-admin-status]');
  if (!listEl) return;

  let cursor = null;
  let requestId = 0;

  async function load({ reset = false } = {}) {
    const id = ++requestId;
    errorEl.hidden = true;
    if (reset) { cursor = null; listEl.innerHTML = ''; moreBtn.hidden = true; }
    try {
      const { completions, next_cursor } = await api.admin.completions({
        search: searchEl.value.trim(), status: statusEl.value, before: reset ? null : cursor,
      });
      if (id !== requestId) return;
      for (const c of completions) listEl.append(submissionRow(c, () => load({ reset: true })));
      if (!listEl.children.length) {
        listEl.append(emptyState({
          iconId: 'i-clipboard-check',
          title: statusEl.value === 'pending' ? t('Nothing is waiting for review') : t('No submissions found'),
          text: t('Try another search or status.'),
        }));
      }
      cursor = next_cursor;
      moreBtn.hidden = !next_cursor;
    } catch (err) {
      if (id !== requestId) return;
      errorEl.textContent = errorMessage(err, 'Could not load submissions.');
      errorEl.hidden = false;
    }
  }

  let debounce;
  searchEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => load({ reset: true }), 300); });
  statusEl.addEventListener('change', () => load({ reset: true }));
  moreBtn.addEventListener('click', () => load());
  await load({ reset: true });
}
