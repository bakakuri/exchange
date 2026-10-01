// js/achievements/achievements.js - behavior for the /achievements
// route: the full catalog (GET /api/achievements) merged with the
// signed-in user's own unlocks (GET /api/achievements/mine) into one
// "unlocked or locked" wall. The XP-to-next-level figure mirrors
// calculate_level()'s formula (1000 XP per level - 015_functions.sql)
// purely for display; it's read from the session's own xp/level, the
// same already-authoritative fields profile-edit.js shows, not
// recomputed as if this page decided it.

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';

function renderLevel(dl, user) {
  dl.innerHTML = '';
  const xpForNextLevel = user.level * 1000;
  dl.append(
    createEl('dt', {}, 'Level'), createEl('dd', {}, String(user.level)),
    createEl('dt', {}, 'XP'), createEl('dd', {}, `${user.xp} (${xpForNextLevel - user.xp} to level ${user.level + 1})`)
  );
}

function renderAchievements(listEl, catalog, unlockedByCode) {
  listEl.innerHTML = '';

  for (const a of catalog) {
    const unlock = unlockedByCode.get(a.code);
    const item = createEl('li', { class: `achievement-card${unlock ? ' achievement-card--unlocked' : ''}` }, [
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
  if (user) renderLevel(levelEl, user);

  try {
    const [{ achievements }, { unlocked }] = await Promise.all([api.achievements.catalog(), api.achievements.mine()]);
    const unlockedByCode = new Map(unlocked.map((u) => [u.achievement.code, u]));
    renderAchievements(listEl, achievements, unlockedByCode);
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load achievements.';
    errorEl.hidden = false;
  }
}
