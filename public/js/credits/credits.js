// js/credits/credits.js - behavior for the /credits route: current
// balance plus a cursor-paginated transaction history.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';

const TYPE_LABELS = {
  task_reward: 'Task reward',
  campaign_reservation: 'Campaign budget reserved',
  campaign_refund: 'Campaign refund',
  referral_reward: 'Referral bonus',
  signup_bonus: 'Signup bonus',
  admin_adjustment: 'Admin adjustment',
  reversal: 'Reversal',
  penalty: 'Penalty',
};

function formatAmount(amount) {
  return amount > 0 ? `+${amount}` : String(amount);
}

// The reward engine's output, by type (Stage 10 - GET /api/credits/summary,
// backed by get_credit_summary() which does the aggregation in the
// database since there's no GROUP BY in the request layer). Ordered by
// total_amount desending so the biggest sources of (or drains on)
// credits lead, rather than whatever order the database happens to
// return groups in.
function renderSummary(dl, byType) {
  dl.innerHTML = '';

  if (byType.length === 0) {
    dl.append(createEl('dt', {}, 'No activity yet'), createEl('dd', {}, ''));
    return;
  }

  const sorted = [...byType].sort((a, b) => b.total_amount - a.total_amount);
  for (const row of sorted) {
    const amountClass = row.total_amount > 0 ? 'ledger-amount ledger-amount--positive' : 'ledger-amount ledger-amount--negative';
    dl.append(
      createEl('dt', {}, `${TYPE_LABELS[row.type] || row.type} (${row.entry_count})`),
      createEl('dd', { class: amountClass }, formatAmount(row.total_amount))
    );
  }
}

function renderEntries(listEl, entries, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  for (const entry of entries) {
    const main = createEl('div', { class: 'ledger-item__main' }, [
      createEl('strong', {}, TYPE_LABELS[entry.type] || entry.type),
      createEl('time', { class: 'ledger-item__date' }, new Date(entry.created_at).toLocaleString()),
    ]);
    if (entry.description) {
      main.insertBefore(
        createEl('p', { class: 'ledger-item__description' }, entry.description),
        main.lastChild
      );
    }

    const amountClass = entry.amount > 0 ? 'ledger-amount ledger-amount--positive' : 'ledger-amount ledger-amount--negative';
    listEl.append(
      createEl('li', { class: 'ledger-item' }, [main, createEl('span', { class: amountClass }, formatAmount(entry.amount))])
    );
  }
}

export async function init() {
  const balanceEl = qs('[data-credits-balance]');
  const summaryEl = qs('[data-credits-summary]');
  const listEl = qs('[data-ledger-list]');
  const loadMoreBtn = qs('#load-more-btn');
  const errorEl = qs('#ledger-error');
  if (!balanceEl || !listEl) return;

  let cursor = null;

  try {
    const { credits } = await api.credits.balance();
    balanceEl.textContent = `${credits} credits`;
  } catch {
    balanceEl.textContent = 'Could not load your balance.';
  }

  try {
    const { by_type } = await api.credits.summary();
    renderSummary(summaryEl, by_type);
  } catch {
    summaryEl.innerHTML = '';
    summaryEl.append(createEl('dt', {}, 'Could not load your summary'), createEl('dd', {}, ''));
  }

  async function loadPage() {
    try {
      const { entries, next_cursor } = await api.credits.ledger(cursor ? { before: cursor } : {});
      renderEntries(listEl, entries, { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
      if (entries.length === 0 && listEl.children.length === 0) {
        listEl.append(createEl('li', { class: 'ledger-item ledger-item--empty' }, 'No transactions yet.'));
      }
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load your transaction history.';
      errorEl.hidden = false;
    }
  }

  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage();
}
