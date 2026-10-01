// js/campaigns/campaigns.js - behavior for the /campaigns route: the
// signed-in user's own campaigns (GET /api/campaigns/mine), filterable
// by status, "load more"-paginated. Managing a single campaign (pause/
// resume/cancel/edit) happens on /campaigns/:id, not here.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { taskPlatformLabel } from '../shared/task-platforms.js';
import { taskTypeLabel } from '../shared/task-types.js';
import { campaignStatusLabel } from './status.js';

function renderCampaigns(listEl, campaigns, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (campaigns.length === 0 && listEl.children.length === 0) {
    listEl.append(createEl('li', { class: 'campaign-list__empty' }, 'No campaigns yet — create one to get started.'));
    return;
  }

  for (const c of campaigns) {
    listEl.append(
      createEl('li', { class: 'campaign-card' }, [
        createEl('a', { href: `/campaigns/${c.id}`, 'data-link': '', class: 'campaign-card__link' }, [
          createEl('div', { class: 'campaign-card__header' }, [
            createEl('strong', {}, c.title),
            createEl('span', { class: `campaign-status campaign-status--${c.status}` }, campaignStatusLabel(c.status)),
          ]),
          createEl(
            'p',
            { class: 'campaign-card__meta' },
            c.task
              ? `${taskPlatformLabel(c.task.platform)} · ${taskTypeLabel(c.task.task_type)} · ${c.reward} credits`
              : `${c.reward} credits`
          ),
          createEl(
            'p',
            { class: 'campaign-card__progress' },
            `${c.completed_count}/${c.desired_completions} completed · ${c.remaining_budget} credits remaining`
          ),
        ]),
      ])
    );
  }
}

export async function init() {
  const listEl = qs('[data-campaign-list]');
  const loadMoreBtn = qs('#campaigns-load-more');
  const errorEl = qs('#campaigns-error');
  const statusSelect = qs('#filter-status');
  if (!listEl) return;

  let cursor = null;

  async function loadPage({ reset = false } = {}) {
    if (reset) cursor = null;
    errorEl.hidden = true;

    try {
      const { campaigns, next_cursor } = await api.campaigns.mine({
        before: cursor,
        status: statusSelect.value || undefined,
      });
      renderCampaigns(listEl, campaigns, { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load campaigns.';
      errorEl.hidden = false;
    }
  }

  statusSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
