// js/profile/social.js
// Linked social accounts management for the /profile page (list, add,
// remove). Kept separate from profile-edit.js so each file keeps to one
// concern - profile-edit.js calls initSocialSection() once its own part
// of the page is wired up.

import { api } from '../shared/api.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { SOCIAL_PLATFORMS, platformLabel } from '../shared/social-platforms.js';

function renderList(listEl, socialProfiles, onRemove) {
  listEl.innerHTML = '';

  if (socialProfiles.length === 0) {
    listEl.append(createEl('li', { class: 'social-list__empty' }, 'No linked accounts yet.'));
    return;
  }

  for (const profile of socialProfiles) {
    const removeBtn = createEl('button', { type: 'button', class: 'social-list__remove' }, 'Remove');
    removeBtn.addEventListener('click', () => onRemove(profile.id));

    listEl.append(
      createEl('li', { class: 'social-list__item' }, [
        createEl('a', { href: profile.profile_url, target: '_blank', rel: 'noopener noreferrer' }, [
          createEl('span', { class: 'social-list__name' }, profile.display_name || profile.username),
          createEl('span', { class: 'social-list__platform' }, platformLabel(profile.platform)),
        ]),
        removeBtn,
      ])
    );
  }
}

export async function initSocialSection() {
  const listEl = qs('[data-social-list]');
  const form = qs('#social-form');
  const errorEl = qs('#social-error');
  if (!listEl || !form) return;

  for (const platform of SOCIAL_PLATFORMS) {
    form.platform.append(new Option(platform.label, platform.value));
  }

  async function load() {
    try {
      const { social_profiles } = await api.social.mine();
      renderList(listEl, social_profiles, handleRemove);
    } catch {
      listEl.innerHTML = '';
      listEl.append(createEl('li', { class: 'social-list__empty' }, 'Could not load linked accounts.'));
    }
  }

  async function handleRemove(id) {
    try {
      await api.social.remove(id);
      await load();
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not remove that account.';
      errorEl.hidden = false;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api.social.create({
        platform: form.platform.value,
        username: form.username.value.trim(),
        profile_url: form.profile_url.value.trim(),
      });
      form.reset();
      form.platform.selectedIndex = 0;
      await load();
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not add that account.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  await load();
}
