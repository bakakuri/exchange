// js/profile/profile-view.js - behavior for the /u/:username route
// (read-only view of someone's profile, including your own).

import { api } from '../shared/api.js';
import { store } from '../core/state.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError, errorMessage } from '../shared/errors.js';
import { navigate } from '../core/router.js';
import { platformLabel } from '../shared/social-platforms.js';
import { t, formatNumber } from '../core/i18n.js';
import { activityLabel } from '../shared/activity-labels.js';
import { serverText } from '../shared/server-text.js';
import { shortDate } from '../shared/time.js';
import { avatar, icon, platformTile } from '../shared/icons.js';
import { categoryChip } from '../shared/member-categories.js';
import { presenceLine } from '../shared/presence.js';
import { shortUrl } from '../shared/platform-links.js';
import { roleLabel } from '../admin/labels.js';

export async function init(params) {
  const container = qs('[data-profile-view-content]');
  if (!container) return;

  container.innerHTML = '';
  container.append(createEl('p', { class: 'profile-view__loading' }, t('Loading…')));

  // member_directory() (022): photos, field of work, presence as the
  // member allows it, and their campaign / task counts.
  let profile;
  try {
    ({ member: profile } = await api.members.get(params.username));
  } catch (err) {
    container.innerHTML = '';
    const message = err instanceof ApiError && err.status === 404
      ? t('No profile found for “{username}”.', { username: params.username })
      : t('Could not load this profile.');
    container.append(createEl('p', {}, message));
    return;
  }

  render(container, profile);
  // One slot each, so the sections keep their order whichever loads first.
  const [social, achievements, activity] = [0, 1, 2].map(() => container.appendChild(createEl('div', { class: 'profile-view__section' })));
  renderSocial(social, profile.username);
  renderAchievements(achievements, profile.username);
  renderActivity(activity, profile.username);
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
            platformTile(p.platform, { size: 'sm' }),
            createEl('span', { class: 'social-list__text' }, [
              createEl('span', { class: 'social-list__name' }, p.display_name || `@${p.username.replace(/^@/, '')}`),
              createEl('span', { class: 'social-list__platform' }, `${platformLabel(p.platform)} · ${shortUrl(p.profile_url)}`),
            ]),
            icon('i-external-link', { size: 16, className: 'social-list__out' }),
          ]),
        ])
      )
    )
  );
}

function statTile(iconId, value, label) {
  return createEl('div', { class: 'stat-tile' }, [
    createEl('span', { class: 'stat-tile__icon' }, [icon(iconId, { size: 18 })]),
    createEl('span', { class: 'stat-tile__value' }, value),
    createEl('span', { class: 'stat-tile__label' }, label),
  ]);
}

function render(container, profile) {
  container.innerHTML = '';

  const isOwn = store.getState().user?.id === profile.id;
  const name = profile.display_name || profile.username;

  const cover = createEl('div', { class: `profile-hero__cover ${profile.cover_url ? 'has-photo' : ''}`.trim() });
  if (profile.cover_url) {
    cover.append(createEl('img', { class: 'profile-hero__cover-img', src: profile.cover_url, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' }));
  }

  const meta = createEl('p', { class: 'profile-hero__meta' }, [createEl('span', {}, `@${profile.username}`)]);
  const chip = categoryChip(profile.category);
  if (chip) meta.append(chip);
  if (profile.role === 'admin') {
    meta.append(createEl('span', { class: 'role-chip' }, [icon('i-shield', { size: 14 }), roleLabel('admin')]));
  }
  const presence = presenceLine(profile);
  if (presence) meta.append(presence);

  const links = createEl('div', { class: 'profile-hero__links' });
  if (isOwn) {
    links.append(createEl('a', { class: 'btn btn--sm', href: '/profile', 'data-link': '' }, [icon('i-pencil', { size: 16 }), t('Edit your profile')]));
  } else if (store.getState().user) {
    // Write to them: opens (or starts) the conversation.
    const write = createEl('button', { type: 'button', class: 'btn btn--primary btn--sm' }, [icon('i-message-circle', { size: 16 }), t('Send a message')]);
    const error = createEl('p', { class: 'form-error', role: 'alert' });
    error.hidden = true;
    write.addEventListener('click', async () => {
      write.disabled = true;
      error.hidden = true;
      try {
        const { conversation_id: id } = await api.messages.start({ user_id: profile.id });
        navigate(`/messages/${id}`);
      } catch (err) {
        write.disabled = false;
        error.textContent = errorMessage(err, 'Could not start the conversation.');
        error.hidden = false;
      }
    });
    links.append(write, error);
  }

  container.append(createEl('div', { class: 'profile-hero profile-hero--public' }, [
    cover,
    createEl('div', { class: 'profile-hero__body' }, [
      createEl('div', { class: 'profile-hero__avatar' }, [avatar(name, { size: 'xl', url: profile.avatar_url, online: profile.is_online === true })]),
      createEl('div', { class: 'profile-hero__who' }, [
        createEl('h1', { class: 'profile-hero__name' }, name),
        meta,
      ]),
      links,
    ]),
  ]));

  if (profile.bio) {
    container.append(createEl('p', { class: 'profile-view__bio' }, profile.bio));
  }

  const tiles = [
    statTile('i-trending-up', String(profile.level), t('Level')),
    statTile('i-sparkles', formatNumber(profile.xp ?? 0), t('XP')),
    statTile('i-megaphone', formatNumber(profile.campaigns_count ?? 0), t('Campaigns')),
    statTile('i-circle-check', formatNumber(profile.completed_count ?? 0), t('Tasks done')),
    statTile('i-calendar', shortDate(profile.created_at), t('Member since')),
  ];
  if (profile.xp > 0 && profile.xp_rank && profile.xp_rank <= 50) {
    tiles.splice(2, 0, statTile('i-crown', `#${profile.xp_rank}`, t('By XP')));
  }
  container.append(createEl('div', { class: 'stat-tiles' }, tiles));
}
