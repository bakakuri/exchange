// js/profile/profile-view.js - behavior for the /u/:username route
// (read-only view of someone's profile, including your own).

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { platformLabel } from '../shared/social-platforms.js';
import { t, formatNumber } from '../core/i18n.js';
import { activityLabel } from '../shared/activity-labels.js';
import { serverText } from '../shared/server-text.js';
import { shortDate } from '../shared/time.js';

export async function init(params) {
  const container = qs('[data-profile-view-content]');
  if (!container) return;

  container.innerHTML = '';
  container.append(createEl('p', { class: 'profile-view__loading' }, t('Loading…')));

  let profile;
  try {
    ({ profile } = await api.profile.byUsername(params.username));
  } catch (err) {
    container.innerHTML = '';
    const message = err instanceof ApiError && err.status === 404
      ? t('No profile found for “{username}”.', { username: params.username })
      : t('Could not load this profile.');
    container.append(createEl('p', {}, message));
    return;
  }

  render(container, profile);
  renderSocial(container, profile.username);
  renderAchievements(container, profile.username);
  renderActivity(container, profile.username);
}

// Only what's unlocked - a public wall of fame, not a hint list of what
// this person hasn't earned yet (that's what /achievements, the
// signed-in user's own catalog-plus-progress view, is for).
async function renderAchievements(container, username) {
  let unlocked;
  try {
    ({ unlocked } = await api.achievements.byUsername(username));
  } catch {
    return; // Non-critical - the profile itself already rendered.
  }
  if (!unlocked || unlocked.length === 0) return;

  container.append(
    createEl('h2', {}, t('Achievements')),
    createEl(
      'ul',
      { class: 'profile-view__achievements' },
      unlocked.map((u) =>
        createEl('li', { class: 'profile-view__achievement-badge', title: serverText(u.achievement.description) }, serverText(u.achievement.title))
      )
    )
  );
}

async function renderActivity(container, username) {
  let activity;
  try {
    ({ activity } = await api.activity.byUsername(username));
  } catch {
    return; // Non-critical - the profile itself already rendered.
  }
  if (!activity || activity.length === 0) return;

  container.append(
    createEl('h2', {}, t('Activity')),
    createEl(
      'ul',
      { class: 'activity-list' },
      activity.map((a) =>
        createEl('li', { class: 'activity-list__item' }, [
          createEl('span', {}, activityLabel(a.type)),
          createEl('time', { class: 'activity-list__date', datetime: a.created_at }, shortDate(a.created_at)),
        ])
      )
    )
  );
}

async function renderSocial(container, username) {
  let social_profiles;
  try {
    ({ social_profiles } = await api.social.byUsername(username));
  } catch {
    return; // Non-critical - the profile itself already rendered.
  }
  if (!social_profiles || social_profiles.length === 0) return;

  container.append(
    createEl('h2', {}, t('Linked accounts')),
    createEl(
      'ul',
      { class: 'social-list social-list--readonly' },
      social_profiles.map((p) =>
        createEl('li', { class: 'social-list__item' }, [
          createEl('a', { href: p.profile_url, target: '_blank', rel: 'noopener noreferrer' }, [
            createEl('span', { class: 'social-list__name' }, p.display_name || p.username),
            createEl('span', { class: 'social-list__platform' }, platformLabel(p.platform)),
          ]),
        ])
      )
    )
  );
}

function render(container, profile) {
  container.innerHTML = '';

  const isOwn = store.getState().user?.id === profile.id;

  container.append(
    createEl('div', { class: 'profile-view__header' }, [
      createEl('h1', {}, profile.display_name || profile.username),
      createEl('p', { class: 'profile-view__username' }, `@${profile.username}`),
    ])
  );

  if (profile.bio) {
    container.append(createEl('p', { class: 'profile-view__bio' }, profile.bio));
  }

  container.append(
    createEl('dl', { class: 'profile-view__stats' }, [
      createEl('dt', {}, t('Level')), createEl('dd', {}, String(profile.level)),
      createEl('dt', {}, t('XP')), createEl('dd', {}, formatNumber(profile.xp ?? 0)),
      createEl('dt', {}, t('Member since')), createEl('dd', {}, shortDate(profile.created_at)),
    ])
  );

  if (isOwn) {
    container.append(
      createEl('p', {}, [createEl('a', { href: '/profile', 'data-link': '' }, t('Edit your profile'))])
    );
  }
}
