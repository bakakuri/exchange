// js/credits/credits.js - behavior for the /credits route: current
// balance, progress toward the one-time welcome bonus (021), and a
// cursor-paginated transaction history.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { shortDateTime, fullDateTime } from '../shared/time.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { serverText } from '../shared/server-text.js';
import { countUp } from '../shared/motion.js';

const TYPE_LABELS = {
  task_reward: () => t('Task reward'),
  campaign_reservation: () => t('Campaign budget reserved'),
  campaign_refund: () => t('Campaign refund'),
  referral_reward: () => t('Referral bonus'),
  signup_bonus: () => t('Welcome bonus'),
  admin_adjustment: () => t('Admin adjustment'),
  reversal: () => t('Reversal'),
  penalty: () => t('Penalty'),
};

const typeLabel = (type) => TYPE_LABELS[type]?.() || type;

function formatAmount(amount) {
  return amount > 0 ? `+${formatNumber(amount)}` : amount < 0 ? `−${formatNumber(-amount)}` : '0';
}

// The reward engine's output, by type (Stage 10 - GET /api/credits/summary,
// backed by get_credit_summary() which does the aggregation in the
// database since there's no GROUP BY in the request layer). Ordered by
// total_amount desending so the biggest sources of (or drains on)
// credits lead, rather than whatever order the database happens to
// return groups in.
// One icon per kind of credit movement, matching the notifications page.
const TYPE_ICONS = {
  task_reward: 'i-coins',
  campaign_reservation: 'i-megaphone',
  campaign_refund: 'i-repeat',
  referral_reward: 'i-users',
  signup_bonus: 'i-sparkles',
  admin_adjustment: 'i-shield',
  reversal: 'i-repeat',
  penalty: 'i-circle-alert',
};

function renderSummary(dl, byType) {
  dl.innerHTML = '';

  if (byType.length === 0) {
    dl.append(createEl('dt', {}, t('No activity yet')), createEl('dd', {}, ''));
    return;
  }

  const sorted = [...byType].sort((a, b) => b.total_amount - a.total_amount);
  for (const row of sorted) {
    const amountClass = row.total_amount > 0 ? 'ledger-amount ledger-amount--positive' : 'ledger-amount ledger-amount--negative';
    dl.append(
      createEl('dt', {}, `${typeLabel(row.type)} (${formatNumber(row.entry_count)})`),
      createEl('dd', { class: amountClass }, formatAmount(row.total_amount))
    );
  }
}

// "Welcome bonus: 10 credits - 1 of 3 creators". Shown until it's paid.
function renderWelcomeBonus(el, bonus) {
  if (!bonus || bonus.granted_at) { el.hidden = true; return; }
  const done = Math.min(bonus.creators_done, bonus.creators_needed);
  const steps = Array.from({ length: bonus.creators_needed }, (_, i) =>
    createEl('span', { class: `welcome-bonus__step${i < done ? ' is-done' : ''}` },
      [icon(i < done ? 'i-check' : 'i-user', { size: 14 })]));
  el.innerHTML = '';
  el.append(
    createEl('span', { class: 'welcome-bonus__icon' }, [icon('i-gift', { size: 22 })]),
    createEl('div', { class: 'welcome-bonus__text' }, [
      createEl('strong', {}, tn(bonus.amount, 'Welcome bonus: {n} credit', 'Welcome bonus: {n} credits')),
      createEl('p', {}, t('Get proofs approved by {needed} different creators - approved by them, not automatically.', {
        needed: formatNumber(bonus.creators_needed),
      })),
    ]),
    createEl('div', { class: 'welcome-bonus__progress', 'aria-label': t('{done} of {needed} creators', {
      done: formatNumber(done), needed: formatNumber(bonus.creators_needed),
    }) }, [
      createEl('div', { class: 'welcome-bonus__steps' }, steps),
      createEl('span', { class: 'welcome-bonus__count' }, t('{done} of {needed} creators', {
        done: formatNumber(done), needed: formatNumber(bonus.creators_needed),
      })),
    ]),
  );
  el.hidden = false;
}

function renderEntries(listEl, entries, { append = false } = {}) {
  if (!append) listEl.innerHTML = '';

  for (const entry of entries) {
    const main = createEl('div', { class: 'ledger-item__main' }, [
      createEl('strong', {}, typeLabel(entry.type)),
      createEl('time', { class: 'ledger-item__date', datetime: entry.created_at, title: fullDateTime(entry.created_at) }, shortDateTime(entry.created_at)),
    ]);
    if (entry.description) {
      main.insertBefore(
        createEl('p', { class: 'ledger-item__description' }, serverText(entry.description)),
        main.lastChild
      );
    }

    const amountClass = entry.amount > 0 ? 'ledger-amount ledger-amount--positive' : 'ledger-amount ledger-amount--negative';
    listEl.append(
      createEl('li', { class: 'ledger-item' }, [
        createEl('span', { class: 'row-icon' }, [icon(TYPE_ICONS[entry.type] || 'i-coins', { size: 18 })]),
        main,
        createEl('span', { class: amountClass }, formatAmount(entry.amount)),
      ])
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
    countUp(balanceEl, credits, (n) => tn(n, '{n} credit', '{n} credits'));
  } catch {
    balanceEl.textContent = t('Could not load your balance.');
  }

  const bonusEl = qs('[data-welcome-bonus]');
  if (bonusEl) {
    api.credits.welcomeBonus()
      .then(({ welcome_bonus: bonus }) => renderWelcomeBonus(bonusEl, bonus))
      .catch(() => { bonusEl.hidden = true; });
  }

  try {
    const { by_type } = await api.credits.summary();
    renderSummary(summaryEl, by_type);
  } catch {
    summaryEl.innerHTML = '';
    summaryEl.append(createEl('dt', {}, t('Could not load your summary')), createEl('dd', {}, ''));
  }

  async function loadPage() {
    try {
      const { entries, next_cursor } = await api.credits.ledger(cursor ? { before: cursor } : {});
      renderEntries(listEl, entries, { append: Boolean(cursor) });
      cursor = next_cursor;
      loadMoreBtn.hidden = !cursor;
      if (entries.length === 0 && listEl.children.length === 0) {
        listEl.append(emptyState({
          iconId: 'i-coins',
          title: t('No transactions yet'),
          text: t('Credits you earn from tasks and spend on campaigns are listed here, newest first.'),
          action: { href: '/tasks', label: t('Find a task') },
          className: 'ledger-item--empty',
        }));
      }
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not load your transaction history.');
      errorEl.hidden = false;
    }
  }

  loadMoreBtn.addEventListener('click', () => loadPage());

  await loadPage();
}
