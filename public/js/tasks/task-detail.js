// js/tasks/task-detail.js - behavior for the /tasks/:id route: detail
// view of a single task, including submitting proof of completion
// (Stage 8) when the task is open, isn't the viewer's own, and hasn't
// been submitted for already. The submission itself goes through
// submit_task_verification() (015_functions.sql via /api/verification) -
// this file just renders the form and re-renders the task's own status
// once a submission exists. Full submission detail (proof, reviewer
// notes on a rejection) lives on the /submissions page, not here - this
// page is about the task, not the history of attempts at it.

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { taskPlatformLabel } from '../shared/task-platforms.js';

import { taskActionLabel } from '../shared/task-label.js';

const STATUS_LABELS = {
  pending: 'Your submission is pending review.',
  approved: 'Your submission was approved — credits already landed in your balance.',
  rejected: 'Your submission was rejected. See your submissions for the reviewer’s notes.',
  expired: 'Your submission expired.',
};

export async function init(params) {
  const container = qs('[data-task-detail-content]');
  if (!container) return;

  container.innerHTML = '';
  container.append(createEl('p', { class: 'task-detail__loading' }, 'Loading…'));

  let task;
  try {
    ({ task } = await api.tasks.get(params.id));
  } catch (err) {
    container.innerHTML = '';
    const message = err instanceof ApiError && err.status === 404 ? 'Task not found.' : 'Could not load this task.';
    container.append(createEl('p', {}, message));
    return;
  }

  render(container, task);
}

function render(container, task) {
  container.innerHTML = '';

  const campaign = task.campaign;
  const isOwn = store.getState().user?.id === campaign.creator_id;
  const isOpen =
    campaign.status === 'active' &&
    campaign.completed_count < campaign.desired_completions &&
    campaign.remaining_budget >= campaign.reward;

  container.append(
    createEl('div', { class: 'task-detail__header' }, [
      createEl('h1', {}, campaign.title),
      createEl('span', { class: 'task-detail__reward' }, `${campaign.reward} credits`),
    ]),
    createEl('p', { class: 'task-detail__meta' }, taskActionLabel(task.task_type, task.platform))
  );

  if (campaign.description) {
    container.append(createEl('p', { class: 'task-detail__description' }, campaign.description));
  }

  if (task.instructions) {
    container.append(createEl('h2', {}, 'Instructions'), createEl('p', {}, task.instructions));
  }

  container.append(
    createEl('a', { href: task.target_url, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn--primary task-detail__open' }, task.platform && task.platform !== 'other' ? `Open on ${taskPlatformLabel(task.platform)}` : 'Open link')
  );

  if (isOwn) {
    container.append(createEl('p', { class: 'task-detail__note' }, 'This is your own task — you can’t complete it yourself.'));
  } else if (task.my_completion) {
    container.append(
      createEl('p', { class: 'task-detail__note' }, STATUS_LABELS[task.my_completion.status] || task.my_completion.status)
    );
  } else if (!isOpen) {
    container.append(createEl('p', { class: 'task-detail__note' }, 'This task is no longer open.'));
  } else {
    container.append(renderSubmitForm(task, container));
  }
}

function renderSubmitForm(task, container) {
  const urlField = createEl('input', { type: 'url', id: 'proof-url', name: 'proof_url', placeholder: 'https://…' });
  const textField = createEl('textarea', { id: 'proof-text', name: 'proof_text', rows: '3' });
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const submitBtn = createEl('button', { type: 'submit', class: 'btn btn--primary' }, 'Submit proof');

  const form = createEl('form', { class: 'form task-detail__submit-form', id: 'submit-proof-form' }, [
    createEl('div', { class: 'field' }, [createEl('label', { for: 'proof-url' }, 'Proof URL (optional)'), urlField]),
    createEl('div', { class: 'field' }, [
      createEl('label', { for: 'proof-text' }, 'Proof notes (optional)'),
      textField,
    ]),
    createEl('p', { class: 'task-detail__submit-hint' }, 'Provide a proof URL, some notes, or both.'),
    errorEl,
    submitBtn,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;

    try {
      const { completion } = await api.verification.submit(task.id, {
        proof_url: urlField.value.trim() || undefined,
        proof_text: textField.value.trim() || undefined,
      });
      task.my_completion = { status: completion.status };
      render(container, task);
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not submit proof.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  return form;
}
