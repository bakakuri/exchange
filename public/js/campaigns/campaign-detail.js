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
import { ApiError } from '../shared/errors.js';

import { campaignStatusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';

export async function init(params) {
  const container = qs('[data-campaign-detail-content]');
  if (!container) return;

  container.innerHTML = '';
  container.append(createEl('p', { class: 'campaign-detail__loading' }, 'Loading…'));

  let campaign;
  try {
    ({ campaign } = await api.campaigns.get(params.id));
  } catch (err) {
    container.innerHTML = '';
    const message = err instanceof ApiError && err.status === 404 ? 'Campaign not found.' : 'Could not load this campaign.';
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
      createEl('dt', {}, 'Reward'), createEl('dd', {}, `${campaign.reward} credits`),
      createEl('dt', {}, 'Progress'), createEl('dd', {}, `${campaign.completed_count}/${campaign.desired_completions} completed`),
      createEl('dt', {}, 'Budget'), createEl('dd', {}, `${campaign.remaining_budget}/${campaign.total_budget} credits remaining`),
      createEl('dt', {}, 'Created'), createEl('dd', {}, new Date(campaign.created_at).toLocaleDateString()),
    ])
  );

  if (campaign.task) {
    const task = campaign.task;
    container.append(
      createEl('h2', {}, 'Task'),
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
  const successEl = createEl('p', { class: 'form-success', role: 'status', hidden: '' }, 'Saved.');
  const submitBtn = createEl('button', { type: 'submit', class: 'btn btn--primary' }, 'Save changes');

  const form = createEl('form', { class: 'form campaign-detail__edit-form', id: 'campaign-edit-form' }, [
    createEl('h2', {}, 'Edit'),
    createEl('div', { class: 'field' }, [createEl('label', { for: 'edit-title' }, 'Title'), titleField]),
    createEl('div', { class: 'field' }, [createEl('label', { for: 'edit-description' }, 'Description'), descriptionField]),
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
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not save those changes.';
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
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not complete that action.';
      errorEl.hidden = false;
    }
  }

  if (campaign.status === 'active') {
    const pauseBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, 'Pause');
    pauseBtn.addEventListener('click', () => runAction(() => api.campaigns.pause(campaign.id)));
    actionsEl.prepend(pauseBtn);
  } else if (campaign.status === 'paused') {
    const resumeBtn = createEl('button', { type: 'button', class: 'btn btn--primary' }, 'Resume');
    resumeBtn.addEventListener('click', () => runAction(() => api.campaigns.resume(campaign.id)));
    actionsEl.prepend(resumeBtn);
  }

  if (campaign.status === 'active' || campaign.status === 'paused') {
    const cancelBtn = createEl('button', { type: 'button', class: 'btn btn--danger' }, 'Cancel campaign');
    const reasonField = createEl('textarea', { rows: '2', placeholder: 'Reason (optional)' });
    const confirmBtn = createEl('button', { type: 'button', class: 'btn btn--danger' }, 'Confirm cancellation');
    const backBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, 'Never mind');
    const cancelForm = createEl('div', { class: 'campaign-detail__cancel-form', hidden: '' }, [
      createEl('p', {}, 'Cancelling refunds any remaining budget and can’t be undone.'),
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
