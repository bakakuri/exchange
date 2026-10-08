// js/campaigns/campaign-detail.js - behavior for the /campaigns/:id
// route: a campaign the signed-in user created - its stats, its one
// task's definition, an edit form for title/description (the only
// fields a direct client UPDATE is allowed to touch - RLS,
// 014_rls.sql), and pause/resume/cancel actions. Every action that
// actually changes campaign state goes through
// set_campaign_pause_state()/cancel_campaign() (015_functions.sql via
// /api/campaigns) - this file only reflects what the database decided,
// the same discipline as review-queue.js's approve/reject actions.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError, errorMessage } from '../shared/errors.js';

import { campaignStatusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';

export async function init(params) {
  const container = qs('[data-campaign-detail-content]');
  if (!container) return;

  container.innerHTML = '';
  container.append(createEl('p', { class: 'campaign-detail__loading' }, t('Loading…')));

  let campaign;
  try {
    ({ campaign } = await api.campaigns.get(params.id));
  } catch (err) {
    container.innerHTML = '';
    const message = err instanceof ApiError && err.status === 404 ? t('Campaign not found.') : errorMessage(err, 'Could not load this campaign.');
    container.append(createEl('p', {}, message));
    return;
  }

  render(container, campaign);
}

function render(container, campaign) {
  container.innerHTML = '';

  container.append(
    createEl('div', { class: 'campaign-detail__header' }, [
      createEl('h1', {}, campaign.title),
      createEl('span', { class: `campaign-status campaign-status--${campaign.status}` }, campaignStatusLabel(campaign.status)),
    ])
  );

  container.append(
    createEl('dl', { class: 'campaign-detail__stats' }, [
      createEl('dt', {}, t('Reward')), createEl('dd', {}, tn(campaign.reward, '{n} credit', '{n} credits')),
      createEl('dt', {}, t('Progress')), createEl('dd', {}, t('{done} of {total} completed', { done: formatNumber(campaign.completed_count), total: formatNumber(campaign.desired_completions) })),
      createEl('dt', {}, t('Budget')), createEl('dd', {}, t('{left} of {total} credits left', { left: formatNumber(campaign.remaining_budget), total: formatNumber(campaign.total_budget) })),
      // Proofs waiting for review hold their place and reward (021).
      ...(campaign.reserved_count > 0 ? [
        createEl('dt', {}, t('Waiting for review')),
        createEl('dd', {}, [
          createEl('a', { href: '/submissions/review', 'data-link': '' },
            tn(campaign.reserved_count, '{n} proof - its place is held', '{n} proofs - their places are held')),
        ]),
      ] : []),
      createEl('dt', {}, t('Created')), createEl('dd', {}, shortDate(campaign.created_at)),
    ])
  );

  if (campaign.task) {
    const task = campaign.task;
    container.append(
      createEl('h2', {}, t('Task')),
      createEl('p', { class: 'campaign-detail__meta' }, taskActionLabel(task.task_type, task.platform)),
      createEl('a', { href: task.target_url, target: '_blank', rel: 'noopener noreferrer' }, task.target_url)
    );
    if (task.instructions) {
      container.append(createEl('p', { class: 'campaign-detail__instructions' }, task.instructions));
    }
  }

  container.append(renderEditForm(campaign, container));
  container.append(renderActions(campaign, container));
}

function renderEditForm(campaign, container) {
  const titleField = createEl('input', { type: 'text', id: 'edit-title', name: 'title', maxlength: '120', value: campaign.title, required: '' });
  const descriptionField = createEl('textarea', { id: 'edit-description', name: 'description', maxlength: '2000', rows: '3' }, campaign.description || '');
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const successEl = createEl('p', { class: 'form-success', role: 'status', hidden: '' }, t('Saved.'));
  const submitBtn = createEl('button', { type: 'submit', class: 'btn btn--primary' }, t('Save changes'));

  const form = createEl('form', { class: 'form campaign-detail__edit-form', id: 'campaign-edit-form' }, [
    createEl('h2', {}, t('Edit')),
    createEl('div', { class: 'field' }, [createEl('label', { for: 'edit-title' }, t('Title')), titleField]),
    createEl('div', { class: 'field' }, [createEl('label', { for: 'edit-description' }, t('Description')), descriptionField]),
    errorEl,
    successEl,
    submitBtn,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    submitBtn.disabled = true;

    try {
      const { campaign: updated } = await api.campaigns.update(campaign.id, {
        title: titleField.value.trim(),
        description: descriptionField.value.trim(),
      });
      successEl.hidden = false;
      render(container, updated);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not save those changes.');
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  return form;
}

function renderActions(campaign, container) {
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const actionsEl = createEl('div', { class: 'campaign-detail__actions' }, [errorEl]);

  async function runAction(fn) {
    errorEl.hidden = true;
    try {
      const { campaign: updated } = await fn();
      render(container, updated);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not complete that action.');
      errorEl.hidden = false;
    }
  }

  if (campaign.status === 'active') {
    const pauseBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, t('Pause'));
    pauseBtn.addEventListener('click', () => runAction(() => api.campaigns.pause(campaign.id)));
    actionsEl.prepend(pauseBtn);
  } else if (campaign.status === 'paused') {
    const resumeBtn = createEl('button', { type: 'button', class: 'btn btn--primary' }, t('Resume'));
    resumeBtn.addEventListener('click', () => runAction(() => api.campaigns.resume(campaign.id)));
    actionsEl.prepend(resumeBtn);
  }

  if (campaign.status === 'active' || campaign.status === 'paused') {
    const cancelBtn = createEl('button', { type: 'button', class: 'btn btn--danger' }, t('Cancel campaign'));
    const reasonField = createEl('textarea', { rows: '2', placeholder: t('Reason (optional)') });
    const confirmBtn = createEl('button', { type: 'button', class: 'btn btn--danger' }, t('Confirm cancellation'));
    const backBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, t('Never mind'));
    const cancelForm = createEl('div', { class: 'campaign-detail__cancel-form', hidden: '' }, [
      createEl('p', {}, campaign.reserved_count > 0
        ? tn(campaign.reserved_count,
          'Cancelling refunds the free budget and can’t be undone. The reward for {n} proof already sent is kept until you review it - whatever isn’t paid comes back to you.',
          'Cancelling refunds the free budget and can’t be undone. The rewards for {n} proofs already sent are kept until you review them - whatever isn’t paid comes back to you.')
        : t('Cancelling refunds any remaining budget and can’t be undone.')),
      reasonField,
      createEl('div', { class: 'submission-card__reject-actions' }, [confirmBtn, backBtn]),
    ]);

    cancelBtn.addEventListener('click', () => {
      cancelForm.hidden = false;
      cancelBtn.hidden = true;
    });
    backBtn.addEventListener('click', () => {
      cancelForm.hidden = true;
      cancelBtn.hidden = false;
    });
    confirmBtn.addEventListener('click', () => runAction(() => api.campaigns.cancel(campaign.id, reasonField.value.trim() || undefined)));

    actionsEl.append(cancelBtn, cancelForm);
  }

  return actionsEl;
}
