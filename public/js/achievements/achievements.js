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
import { ApiError } from '../shared/errors.js';
import { icon } from '../shared/icons.js';

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
  setText('[data-achievements-xp]', `${into} of ${XP_PER_LEVEL} XP to level ${level + 1} · ${xp} XP total`);
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
        createEl('strong', {}, a.title),
        createEl('span', { class: 'achievement-card__status' }, unlock ? 'Unlocked' : 'Locked'),
      ]),
      createEl('p', { class: 'achievement-card__description' }, a.description),
    ]);
    if (unlock) {
      item.append(createEl('p', { class: 'achievement-card__date' }, new Date(unlock.unlocked_at).toLocaleDateString()));
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
    setText('[data-achievements-count]', `${unlockedByCode.size} of ${achievements.length}`);
    renderAchievements(listEl, achievements, unlockedByCode);
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load achievements.';
    errorEl.hidden = false;
  }
}
