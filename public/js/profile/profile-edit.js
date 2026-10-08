// js/profile/profile-edit.js - behavior for the /profile route: view
// and edit the signed-in user's own profile.

import { api } from '../shared/api.js';
import { updateCachedUser } from '../auth/auth.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { initSocialSection } from './social.js';
import { t, formatNumber } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';
import { setLanguage, useAutomaticLanguage } from '../core/language.js';

function renderStats(user) {
  const dl = qs('[data-profile-stats]');
  if (!dl) return;
  dl.innerHTML = '';
  const rows = [
    [t('Level'), user.level],
    [t('XP'), formatNumber(user.xp ?? 0)],
    [t('Credits'), formatNumber(user.credits ?? 0)],
    [t('Member since'), shortDate(user.created_at)],
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
  // Site language: a code from before this was a menu (e.g. "de") is
  // kept as its own option so saving the form doesn't erase it.
  const lang = user.language || '';
  if (lang && ![...form.language.options].some((o) => o.value === lang)) form.language.append(new Option(lang, lang));
  form.language.value = lang;
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
    errorEl.textContent = errorMessage(err, 'Could not load your profile.');
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
        language: form.language.value || null,
      });

      const languageChanged = updated.language !== profile.language;
      profile = updated;
      updateCachedUser(updated);
      fillForm(form, updated);
      renderStats(updated);
      if (viewLink) viewLink.setAttribute('href', `/u/${updated.username}`);
      successEl.hidden = false;
      if (languageChanged) {
        if (updated.language) setLanguage(updated.language, { remember: true });
        else useAutomaticLanguage();
      }
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not save your profile. Please try again.');
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
