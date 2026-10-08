// js/tasks/task-detail.js - behavior for the /tasks/:id route: detail
// view of a single task, the creator's track record, and - when the task
// is open, isn't the viewer's own, and hasn't been done yet - the way to
// complete it: proof for tasks a person checks (proof-form.js) or the
// three link-click steps for Visit / View / Listen tasks checked
// automatically (link-click.js). Everything is re-checked by the
// database; this file only renders and re-renders the task's status.
// Full submission detail lives on /submissions.

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError, errorMessage } from '../shared/errors.js';
import { taskPlatformLabel } from '../shared/task-platforms.js';

import { taskActionLabel } from '../shared/task-label.js';
import { t, tn } from '../core/i18n.js';
import { timeAgo } from '../shared/time.js';
import { trustLine } from '../shared/creator-trust.js';
import { renderProofForm } from './proof-form.js';
import { renderLinkClick } from './link-click.js';

function statusNote(completion) {
  switch (completion.status) {
    case 'pending':
      // auto_approve_at / expires_at come from completion_details (021): members
      // with many rejected proofs wait for a person, and expire after 3 days.
      if (completion.auto_approve_at) {
        return t('Your submission is pending review. If nobody reviews it, it’s approved automatically {when}.',
          { when: timeAgo(completion.auto_approve_at) });
      }
      if (completion.expires_at) {
        return t('Your submission is waiting for the creator’s review. If nobody reviews it, it expires {when}.',
          { when: timeAgo(completion.expires_at) });
      }
      return t('Your submission is pending review.');
    case 'approved':
      return completion.auto_approved
        ? t('Approved automatically — credits already landed in your balance.')
        : t('Your submission was approved — credits already landed in your balance.');
    case 'rejected':
      return completion.appeal_status === 'open'
        ? t('Your submission was rejected. You appealed - an admin will look at it.')
        : t('Your submission was rejected. See your submissions for the reviewer’s notes - you can appeal there within 7 days.');
    case 'expired': return t('Your submission expired.');
    case 'reversed': return t('The reward for this task was taken back - the action was undone.');
    default: return completion.status;
  }
}

export async function init(params) {
  const container = qs('[data-task-detail-content]');
  if (!container) return;

  container.innerHTML = '';
  container.append(createEl('p', { class: 'task-detail__loading' }, t('Loading…')));

  let task;
  try {
    ({ task } = await api.tasks.get(params.id));
  } catch (err) {
    container.innerHTML = '';
    const message = err instanceof ApiError && err.status === 404 ? t('Task not found.') : errorMessage(err, 'Could not load this task.');
    container.append(createEl('p', {}, message));
    return;
  }

  render(container, task);
}

function render(container, task) {
  container.innerHTML = '';

  const campaign = task.campaign;
  const isOwn = store.getState().user?.id === campaign.creator_id;
  // Proofs waiting for review hold their places (021): places_left counts them.
  const placesLeft = Number(task.places_left) || 0;
  const isOpen = campaign.status === 'active' && placesLeft > 0;

  container.append(
    createEl('div', { class: 'task-detail__header' }, [
      createEl('h1', {}, campaign.title),
      createEl('span', { class: 'task-detail__reward' }, tn(campaign.reward, '{n} credit', '{n} credits')),
    ]),
    createEl('p', { class: 'task-detail__meta' }, [
      taskActionLabel(task.task_type, task.platform),
      ...(isOpen ? [createEl('span', { class: 'places-left' }, tn(placesLeft, '{n} place left', '{n} places left'))] : []),
    ])
  );
  if (task.verification_method !== 'link_click') container.append(trustLine(task.creator_stats));

  if (campaign.description) {
    container.append(createEl('p', { class: 'task-detail__description' }, campaign.description));
  }

  if (task.instructions) {
    container.append(createEl('h2', {}, t('Instructions')), createEl('p', {}, task.instructions));
  }

  const openLabel = task.platform && task.platform !== 'other'
    ? t('Open on {platform}', { platform: taskPlatformLabel(task.platform) })
    : t('Open link');
  const canDo = !isOwn && !task.my_completion && isOpen;
  const done = (completion) => {
    task.my_completion = completion;
    render(container, task);
  };

  // A link-click task's link is opened from its own card, so the click counts.
  if (!(canDo && task.verification_method === 'link_click')) {
    container.append(
      createEl('a', { href: task.target_url, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn--primary task-detail__open' }, openLabel)
    );
  }

  if (isOwn) {
    container.append(createEl('p', { class: 'task-detail__note' }, t('This is your own task — you can’t complete it yourself.')));
  } else if (task.my_completion) {
    container.append(createEl('p', { class: `task-detail__note task-detail__note--${task.my_completion.status}` }, statusNote(task.my_completion)));
  } else if (!isOpen) {
    container.append(createEl('p', { class: 'task-detail__note' }, t('This task is no longer open.')));
  } else if (task.verification_method === 'link_click') {
    container.append(renderLinkClick(task, openLabel, done));
  } else {
    container.append(renderProofForm(task, done));
  }
}
