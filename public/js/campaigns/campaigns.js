// js/campaigns/campaigns.js - behavior for the /campaigns route: the
// signed-in user's own campaigns (GET /api/campaigns/mine), filterable
// by status, "load more"-paginated. Managing a single campaign (pause/
// resume/cancel/edit) happens on /campaigns/:id, not here.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';

import { campaignStatusLabel } from './status.js';
import { taskActionLabel } from '../shared/task-label.js';
import { platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { t, tn, formatNumber } from '../core/i18n.js';

function renderCampaigns(listEl, campaigns, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  if (campaigns.length === 0 && listEl.children.length === 0) {
    listEl.append(emptyState({
      iconId: 'i-megaphone',
      title: t('No campaigns yet'),
      text: t('A campaign asks other members to follow, like or subscribe to your page. You set the reward per person and how many people you want.'),
      action: { href: '/campaigns/new', label: t('Create a campaign') },
      className: 'campaign-list__empty',
    }));
    return;
  }

  for (const c of campaigns) {
    listEl.append(
      createEl('li', { class: 'campaign-card' }, [
        createEl('a', { href: `/campaigns/${c.id}`, 'data-link': '', class: 'campaign-card__link' }, [
          platformTile(c.task?.platform || 'other'),
          createEl('span', { class: 'campaign-card__body' }, [
          createEl('div', { class: 'campaign-card__header' }, [
            createEl('strong', {}, c.title),
            createEl('span', { class: `campaign-status campaign-status--${c.status}` }, campaignStatusLabel(c.status)),
          ]),
          createEl(
            'p',
            { class: 'campaign-card__meta' },
            c.task
              ? t('{action}, {amount} each', { action: taskActionLabel(c.task.task_type, c.task.platform), amount: tn(c.reward, '{n} credit', '{n} credits') })
              : tn(c.reward, '{n} credit', '{n} credits')
          ),
          createEl('span', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0',
            'aria-valuemax': String(c.desired_completions), 'aria-valuenow': String(c.completed_count),
            'aria-label': t('Completions') }, [
            createEl('span', { class: 'progress__bar', style: `width: ${Math.min(100, Math.round((c.completed_count / Math.max(1, c.desired_completions)) * 100))}%` }),
          ]),
          createEl(
            'p',
            { class: 'campaign-card__progress' },
            t('{done} of {total} done, {left} credits left', { done: formatNumber(c.completed_count), total: formatNumber(c.desired_completions), left: formatNumber(c.remaining_budget) })
          ),
          ]),
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
      errorEl.textContent = errorMessage(err, 'Could not load campaigns.');
      errorEl.hidden = false;
    }
  }

  statusSelect.addEventListener('change', () => loadPage({ reset: true }));
  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage({ reset: true });
}
