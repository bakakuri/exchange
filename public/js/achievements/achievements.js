// js/achievements/achievements.js - behavior for the /achievements
// route: the full catalog (GET /api/achievements) merged with the
// signed-in user's own unlocks (GET /api/achievements/mine) into one
// "unlocked or locked" wall. The level panel mirrors calculate_level()'s
// formula (1000 XP per level - 015_functions.sql) purely for display;
// it's read from the session's own xp/level, the same already-
// authoritative fields profile-edit.js shows, not recomputed as if this
// page decided it.

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { t, formatNumber } from '../core/i18n.js';
import { serverText } from '../shared/server-text.js';
import { shortDate } from '../shared/time.js';

const XP_PER_LEVEL = 1000;

const setText = (sel, text) => {
  const el = qs(sel);
  if (el) el.textContent = text;
};

function renderLevel(panel, user) {
  const level = user.level ?? 1;
  const xp = user.xp ?? 0;
  // XP inside the current level (level = floor(xp / 1000) + 1).
  const into = ((xp % XP_PER_LEVEL) + XP_PER_LEVEL) % XP_PER_LEVEL;
  setText('[data-achievements-level-value]', String(level));
  setText('[data-achievements-xp]', `${t('{xp} of {total} XP to level {next}', { xp: formatNumber(into), total: formatNumber(XP_PER_LEVEL), next: level + 1 })} · ${t('{xp} XP total', { xp: formatNumber(xp) })}`);
  const bar = qs('[data-achievements-xp-bar]');
  if (bar) {
    bar.setAttribute('aria-valuenow', String(into));
    bar.firstElementChild.style.width = `${Math.min(100, Math.round((into / XP_PER_LEVEL) * 100))}%`;
  }
  panel.hidden = false;
}

function renderAchievements(listEl, catalog, unlockedByCode) {
  listEl.innerHTML = '';

  for (const a of catalog) {
    const unlock = unlockedByCode.get(a.code);
    const item = createEl('li', { class: `achievement-card${unlock ? ' achievement-card--unlocked' : ''}` }, [
      createEl('span', { class: 'achievement-card__icon' }, [icon(unlock ? 'i-award' : 'i-lock', { size: 20 })]),
      createEl('div', { class: 'achievement-card__header' }, [
        createEl('strong', {}, serverText(a.title)),
        createEl('span', { class: 'achievement-card__status' }, unlock ? t('Unlocked') : t('Locked')),
      ]),
      createEl('p', { class: 'achievement-card__description' }, serverText(a.description)),
    ]);
    if (unlock) {
      item.append(createEl('p', { class: 'achievement-card__date' }, shortDate(unlock.unlocked_at)));
    }
    listEl.append(item);
  }
}

export async function init() {
  const levelEl = qs('[data-achievements-level]');
  const listEl = qs('[data-achievement-list]');
  const errorEl = qs('#achievements-error');
  if (!listEl) return;

  const user = store.getState().user;
  if (user && levelEl) renderLevel(levelEl, user);

  try {
    const [{ achievements }, { unlocked }] = await Promise.all([api.achievements.catalog(), api.achievements.mine()]);
    const unlockedByCode = new Map(unlocked.map((u) => [u.achievement.code, u]));
    setText('[data-achievements-count]', t('{got} of {total}', { got: unlockedByCode.size, total: achievements.length }));
    renderAchievements(listEl, achievements, unlockedByCode);
  } catch (err) {
    errorEl.textContent = errorMessage(err, 'Could not load achievements.');
    errorEl.hidden = false;
  }
}
