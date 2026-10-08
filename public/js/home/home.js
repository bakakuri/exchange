// js/home/home.js
// Behavior for the "/" route. pages/home.html holds both views; this shows
// the visitor explainer or the signed-in dashboard and fills in the live
// parts. Everything user-supplied goes through createEl() (textContent),
// never innerHTML.

import { store } from '../core/state.js';
import { api } from '../shared/api.js';
import { qs, qsa, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { TASK_PLATFORMS } from '../shared/task-platforms.js';
import { taskActionLabel } from '../shared/task-label.js';
import { icon, platformIcon, platformTile } from '../shared/icons.js';
import { emptyState } from '../shared/empty-state.js';
import { timeAgo, fullDateTime, longDay } from '../shared/time.js';
import { t, tn, formatNumber } from '../core/i18n.js';
import { activityLabel } from '../shared/activity-labels.js';

const DASHBOARD_TASKS = 5;
const DASHBOARD_ACTIVITY = 5;
const XP_PER_LEVEL = 1000; // calculate_level() in 015_functions.sql
const SVG_NS = 'http://www.w3.org/2000/svg';

function showView(name) {
  qsa('[data-home-visitor]').forEach((el) => { el.hidden = name !== 'visitor'; });
  qsa('[data-home-member]').forEach((el) => { el.hidden = name !== 'member'; });
}

const setText = (sel, text) => {
  const el = qs(sel);
  if (el) el.textContent = text;
};

// ── Visitor ────────────────────────────────────────────────────────────

function renderVisitor() {
  showView('visitor');
  const row = qs('[data-home-logos]');
  if (!row || row.children.length) return;
  for (const p of TASK_PLATFORMS) {
    if (p.value === 'other' || p.value === 'linkedin') continue;
    row.append(createEl('li', { title: p.label }, [platformIcon(p.value, { size: 20, label: p.label })]));
  }
}

// ── Dashboard helpers ──────────────────────────────────────────────────

function setCredits(n) {
  setText('[data-home-credits]', formatNumber(n));
  setText('[data-home-credits-unit]', tn(n, 'credit', 'credits'));
}

function greeting(name) {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return t('Good morning, {name}', { name });
  if (h >= 12 && h < 18) return t('Good afternoon, {name}', { name });
  return t('Good evening, {name}', { name });
}

function formatSigned(n) {
  if (n > 0) return `+${formatNumber(n)}`;
  if (n < 0) return `−${formatNumber(Math.abs(n))}`;
  return '0';
}

// Balance history from the real ledger (balance_after per entry, newest
// first from the API) drawn as a line + soft area.
function renderSparkline(el, entries) {
  el.innerHTML = '';
  const ordered = [...entries].reverse();
  if (ordered.length === 0) {
    el.append(createEl('p', { class: 'spark__empty' }, t('Your balance history appears after your first transaction.')));
    return;
  }
  const values = [ordered[0].balance_after - ordered[0].amount, ...ordered.map((e) => e.balance_after)];
  const w = 300;
  const h = 64;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'spark__svg');
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', `${line} L${w},${h} L0,${h} Z`);
  area.setAttribute('class', 'spark__area');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', line);
  path.setAttribute('class', 'spark__line');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(area, path);
  el.append(svg);
}

function renderDelta(entries) {
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = entries.filter((e) => new Date(e.created_at).getTime() >= weekAgo);
  const sum = recent.reduce((acc, e) => acc + e.amount, 0);
  const el = qs('[data-home-delta]');
  if (!el) return;
  el.classList.toggle('is-up', sum > 0);
  el.textContent = recent.length ? t('{amount} in the last 7 days', { amount: formatSigned(sum) }) : t('No movement in the last 7 days');
}

function renderLevel(user) {
  const level = user.level ?? 1;
  const xp = user.xp ?? 0;
  // XP inside the current level (level = floor(xp / 1000) + 1).
  const into = ((xp % XP_PER_LEVEL) + XP_PER_LEVEL) % XP_PER_LEVEL;
  const pct = Math.min(100, Math.round((into / XP_PER_LEVEL) * 100));
  setText('[data-home-level]', t('Level {level}', { level }));
  setText('[data-home-xp]', t('{xp} of {total} XP to level {next}', { xp: formatNumber(into), total: formatNumber(XP_PER_LEVEL), next: level + 1 }));
  const bar = qs('[data-home-xp-bar]');
  if (bar) {
    bar.setAttribute('aria-valuenow', String(into));
    bar.firstElementChild.style.width = `${pct}%`;
  }
}

function renderTasks(listEl, tasks) {
  listEl.innerHTML = '';
  if (!tasks.length) {
    listEl.append(emptyState({
      iconId: 'i-list-checks',
      title: t('No open tasks right now'),
      text: t('New tasks appear as soon as someone launches a campaign.'),
      action: { href: '/campaigns/new', label: t('Start a campaign') },
      className: 'home-task-list__empty',
    }));
    return;
  }
  for (const task of tasks.slice(0, DASHBOARD_TASKS)) {
    listEl.append(
      createEl('li', {}, [
        createEl('a', { class: 'home-task', href: `/tasks/${task.id}`, 'data-link': '' }, [
          platformTile(task.platform, { size: 'sm' }),
          createEl('span', { class: 'home-task__main' }, [
            createEl('span', { class: 'home-task__title' }, task.campaign_title),
            createEl('span', { class: 'home-task__action' }, taskActionLabel(task.task_type, task.platform)),
          ]),
          createEl('span', { class: 'reward-chip' }, `+${formatNumber(task.reward)}`),
        ]),
      ])
    );
  }
}

const ACTIVITY_ICONS = {
  task_completed: 'i-circle-check',
  reward_earned: 'i-coins',
  campaign_created: 'i-megaphone',
  campaign_completed: 'i-megaphone',
  verification_submitted: 'i-inbox',
  verification_reviewed: 'i-clipboard-check',
  achievement_unlocked: 'i-award',
  referral_joined: 'i-users',
};

function renderActivity(listEl, items) {
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.append(createEl('li', { class: 'activity-feed__empty' }, t('Tasks you complete and campaigns you launch will show up here.')));
    return;
  }
  for (const a of items.slice(0, DASHBOARD_ACTIVITY)) {
    listEl.append(createEl('li', {}, [
      icon(ACTIVITY_ICONS[a.type] || 'i-sparkles', { size: 16 }),
      createEl('span', { class: 'activity-feed__label' }, activityLabel(a.type)),
      createEl('time', { datetime: a.created_at, title: fullDateTime(a.created_at) }, timeAgo(a.created_at)),
    ]));
  }
}

// ── Signed in ──────────────────────────────────────────────────────────

async function renderMember(user) {
  showView('member');
  const name = user.display_name || user.username || t('there');
  setText('[data-home-greeting]', greeting(name.split(' ')[0]));
  setText('[data-home-date]', longDay());
  setCredits(user.credits ?? 0);
  renderLevel(user);

  const listEl = qs('[data-home-tasks]');
  const errorEl = qs('[data-home-error]');

  const [balance, ledger, unread, review, tasks, activity, catalog, unlocked] = await Promise.allSettled([
    api.credits.balance(),
    api.credits.ledger(),
    api.notifications.unreadCount(),
    api.verification.toReview({ status: 'pending' }),
    api.tasks.listOpen(),
    api.activity.mine(),
    api.achievements.catalog(),
    api.achievements.mine(),
  ]);

  if (catalog.status === 'fulfilled' && unlocked.status === 'fulfilled') {
    const total = (catalog.value.achievements || []).length;
    const got = (unlocked.value.unlocked || []).length;
    if (total) {
      setText('[data-home-badge-count]', t('{got} of {total}', { got, total }));
      const badges = qs('[data-home-badges]');
      if (badges) badges.hidden = false;
    }
  }

  if (balance.status === 'fulfilled') setCredits(balance.value.credits);

  const sparkEl = qs('[data-home-spark]');
  if (ledger.status === 'fulfilled') {
    const entries = ledger.value.entries || [];
    renderDelta(entries);
    if (sparkEl) renderSparkline(sparkEl, entries);
  } else {
    setText('[data-home-delta]', '');
    if (sparkEl) sparkEl.innerHTML = '';
  }

  if (unread.status === 'fulfilled') {
    const n = unread.value.unread_count || 0;
    setText('[data-home-unread]', n ? t('{n} unread', { n }) : t('All caught up'));
  } else setText('[data-home-unread]', t('Open notifications'));

  if (review.status === 'fulfilled') {
    const { completions = [], next_cursor: more } = review.value;
    const n = completions.length;
    setText('[data-home-review]', n ? t('{n} waiting for you', { n: more ? `${n}+` : n }) : t('Nothing waiting'));
  } else setText('[data-home-review]', t('Open your review queue'));

  if (tasks.status === 'fulfilled') {
    renderTasks(listEl, tasks.value.tasks || []);
  } else if (errorEl) {
    errorEl.textContent = errorMessage(tasks.reason, 'Could not load open tasks. Refresh to try again.');
    errorEl.hidden = false;
  }

  const activityEl = qs('[data-home-activity]');
  if (activityEl) renderActivity(activityEl, activity.status === 'fulfilled' ? activity.value.activity || [] : []);
}

export function init() {
  if (!qs('[data-home]')) return;
  const user = store.getState().user;
  if (user) renderMember(user);
  else renderVisitor();
}
