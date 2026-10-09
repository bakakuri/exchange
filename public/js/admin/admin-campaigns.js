// js/admin/admin-campaigns.js - /admin/campaigns (022).
// Every member's campaigns, newest first, searchable by title and
// filterable by status. An admin can pause, resume or cancel any of them;
// each needs a reason, which the creator receives as a notification
// (admin_campaign_action()). Cancelling refunds what isn't held for proofs
// already sent, exactly as when the creator cancels.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon, platformTile, avatar } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { campaignStatusLabel } from '../campaigns/status.js';
import { taskTypeLabel } from '../shared/task-types.js';
import { shortUrl } from '../shared/platform-links.js';
import { shortDate } from '../shared/time.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { mountAdminTabs } from './admin-tabs.js';

const ACTIONS = {
  pause: { icon: 'i-pause', label: () => t('Pause'), confirm: () => t('Pause campaign'), when: ['active'] },
  resume: { icon: 'i-play', label: () => t('Resume'), confirm: () => t('Resume campaign'), when: ['paused'] },
  cancel: { icon: 'i-ban', label: () => t('Cancel'), confirm: () => t('Cancel campaign'), when: ['active', 'paused'], danger: true },
};

function reasonForm(onSubmit, { label, danger }) {
  const textarea = createEl('textarea', { rows: '2', maxlength: '500', required: '', 'aria-label': t('Reason (the creator sees it)'), placeholder: t('Reason (the creator sees it)') });
  const submit = createEl('button', { type: 'submit', class: `btn btn--sm ${danger ? 'btn--danger' : 'btn--primary'}` }, label);
  const cancel = createEl('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, t('Back'));
  const error = createEl('p', { class: 'form-error', role: 'alert' });
  error.hidden = true;
  const form = createEl('form', { class: 'admin-inline-form', novalidate: '' }, [
    textarea, error, createEl('div', { class: 'admin-inline-form__actions' }, [submit, cancel]),
  ]);
  cancel.addEventListener('click', () => form.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = textarea.value.trim();
    if (reason.length < 3) {
      error.textContent = t('Write a short reason (at least 3 characters).');
      error.hidden = false;
      textarea.focus();
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    try {
      await onSubmit(reason);
    } catch (err) {
      error.textContent = errorMessage(err, 'That did not work. Please try again.');
      error.hidden = false;
      submit.disabled = false;
    }
  });
  requestAnimationFrame(() => textarea.focus());
  return form;
}

function campaignRow(c, replace) {
  const task = c.task || {};
  const progress = c.desired_completions ? Math.min(100, Math.round((c.completed_count / c.desired_completions) * 100)) : 0;
  const creatorName = c.creator?.display_name || c.creator?.username || '—';

  const actions = createEl('div', { class: 'admin-row__actions' });
  const row = createEl('li', { class: 'admin-row' }, [
    createEl('div', { class: 'admin-row__main' }, [
      platformTile(task.platform || 'other'),
      createEl('div', { class: 'admin-row__text' }, [
        createEl('p', { class: 'admin-row__title' }, c.title),
        createEl('p', { class: 'admin-row__meta' }, [
          createEl('span', {}, taskTypeLabel(task.task_type)),
          task.target_url
            ? createEl('a', { href: task.target_url, target: '_blank', rel: 'noopener noreferrer' }, [shortUrl(task.target_url), icon('i-external-link', { size: 12 })])
            : '',
        ]),
        createEl('p', { class: 'admin-row__meta' }, [
          c.creator
            ? createEl('a', { class: 'admin-person', href: `/admin/users/${c.creator_id}`, 'data-link': '' }, [
              avatar(creatorName, { size: 'sm', url: c.creator.avatar_url }), `@${c.creator.username}`,
            ])
            : createEl('span', {}, creatorName),
          createEl('span', {}, shortDate(c.created_at)),
        ]),
      ]),
      createEl('span', { class: `campaign-status campaign-status--${c.status}`, title: c.paused_by_admin ? t('Paused by a moderator') : '' },
        c.paused_by_admin ? [icon('i-shield', { size: 12 }), campaignStatusLabel(c.status)] : campaignStatusLabel(c.status)),
    ]),
    createEl('div', { class: 'admin-row__numbers' }, [
      createEl('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress), 'aria-label': t('Progress') }, [
        createEl('span', { class: 'progress__bar', style: `width: ${progress}%` }),
      ]),
      createEl('span', {}, t('{done} of {total} done', { done: formatNumber(c.completed_count), total: formatNumber(c.desired_completions) })),
      createEl('span', {}, tn(c.reward, '{n} credit each', '{n} credits each')),
      createEl('span', {}, t('{n} left in budget', { n: formatNumber(c.remaining_budget) })),
    ]),
    actions,
  ]);

  for (const [action, spec] of Object.entries(ACTIONS)) {
    if (!spec.when.includes(c.status)) continue;
    const btn = createEl('button', { type: 'button', class: `btn btn--sm ${spec.danger ? 'btn--danger' : ''}`.trim() }, [icon(spec.icon, { size: 16 }), spec.label()]);
    btn.addEventListener('click', () => {
      row.querySelector('.admin-inline-form')?.remove();
      row.append(reasonForm(async (reason) => {
        const { campaign } = await api.admin.campaignAction(c.id, action, reason);
        replace(row, campaign || { ...c, status: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled' });
      }, { label: spec.confirm(), danger: spec.danger }));
    });
    actions.append(btn);
  }
  if (!actions.childNodes.length) actions.remove();
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

  const replace = (oldRow, campaign) => oldRow.replaceWith(campaignRow(campaign, replace));

  async function load({ reset = false } = {}) {
    const id = ++requestId;
    errorEl.hidden = true;
    if (reset) { cursor = null; listEl.innerHTML = ''; moreBtn.hidden = true; }
    try {
      const { campaigns, next_cursor } = await api.admin.campaigns({
        search: searchEl.value.trim(), status: statusEl.value, before: reset ? null : cursor,
      });
      if (id !== requestId) return;
      for (const c of campaigns) listEl.append(campaignRow(c, replace));
      if (!listEl.children.length) {
        listEl.append(emptyState({ iconId: 'i-megaphone', title: t('No campaigns found'), text: t('Try another search or status.') }));
      }
      cursor = next_cursor;
      moreBtn.hidden = !next_cursor;
    } catch (err) {
      if (id !== requestId) return;
      errorEl.textContent = errorMessage(err, 'Could not load campaigns.');
      errorEl.hidden = false;
    }
  }

  let debounce;
  searchEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => load({ reset: true }), 300); });
  statusEl.addEventListener('change', () => load({ reset: true }));
  moreBtn.addEventListener('click', () => load());
  await load({ reset: true });
}
