// js/profile/profile-edit.js - behavior for the /profile route: view
// and edit the signed-in user's own profile.

import { api } from '../shared/api.js';
import { updateCachedUser } from '../auth/auth.js';
import { qs, createEl } from '../shared/dom.js';
import { ApiError } from '../shared/errors.js';
import { initSocialSection } from './social.js';

function renderStats(user) {
  const dl = qs('[data-profile-stats]');
  if (!dl) return;
  dl.innerHTML = '';
  const rows = [
    ['Level', user.level],
    ['XP', user.xp],
    ['Credits', user.credits],
    ['Member since', new Date(user.created_at).toLocaleDateString()],
  ];
  for (const [label, value] of rows) {
    dl.append(createEl('dt', {}, label), createEl('dd', {}, String(value)));
  }
}

function fillForm(form, user) {
  form.username.value = user.username || '';
  form.display_name.value = user.display_name || '';
  form.avatar_url.value = user.avatar_url || '';
  form.bio.value = user.bio || '';
  form.country.value = user.country || '';
  form.language.value = user.language || '';
}

export async function init() {
  const form = qs('#profile-form');
  const errorEl = qs('#profile-error');
  const successEl = qs('#profile-success');
  const viewLink = qs('#view-profile-link');
  if (!form) return;

  let profile;
  try {
    ({ profile } = await api.profile.me());
  } catch (err) {
    errorEl.textContent = err instanceof ApiError ? err.message : 'Could not load your profile.';
    errorEl.hidden = false;
    return;
  }

  fillForm(form, profile);
  renderStats(profile);
  if (viewLink) viewLink.setAttribute('href', `/u/${profile.username}`);
  initSocialSection();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const { profile: updated } = await api.profile.update({
        username: form.username.value.trim(),
        display_name: form.display_name.value.trim() || null,
        avatar_url: form.avatar_url.value.trim() || null,
        bio: form.bio.value.trim() || null,
        country: form.country.value.trim().toUpperCase() || null,
        language: form.language.value.trim().toLowerCase() || null,
      });

      updateCachedUser(updated);
      fillForm(form, updated);
      renderStats(updated);
      if (viewLink) viewLink.setAttribute('href', `/u/${updated.username}`);
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Could not save your profile. Please try again.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
