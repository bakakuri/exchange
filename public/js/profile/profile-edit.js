// js/profile/profile-edit.js - behavior for the /profile route: view
// and edit the signed-in user's own profile.
//
// Photos (022): the avatar and cover are picked from the device, placed
// in the crop dialog (image-crop.js) and uploaded as images - there are
// no URL fields. The field of work and the "show when I'm online" switch
// are saved with the rest of the form.

import { api } from '../shared/api.js';
import { updateCachedUser } from '../auth/auth.js';
import { qs, createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { initSocialSection } from './social.js';
import { t, formatNumber } from '../core/i18n.js';
import { setLanguage, useAutomaticLanguage } from '../core/language.js';
import { avatar, icon } from '../shared/icons.js';
import { MEMBER_CATEGORIES, categoryChip } from '../shared/member-categories.js';
import { cropImage } from '../shared/image-crop.js';
import { celebrate } from '../shared/motion.js';

function renderStats(user) {
  const box = qs('[data-profile-stats]');
  if (!box) return;
  const tiles = [
    ['i-trending-up', String(user.level), t('Level')],
    ['i-sparkles', formatNumber(user.xp ?? 0), t('XP')],
    ['i-coins', formatNumber(user.credits ?? 0), t('Credits')],
  ];
  box.replaceChildren(...tiles.map(([iconId, value, label]) => createEl('div', { class: 'stat-tile' }, [
    createEl('span', { class: 'stat-tile__icon' }, [icon(iconId, { size: 18 })]),
    createEl('span', { class: 'stat-tile__value' }, value),
    createEl('span', { class: 'stat-tile__label' }, label),
  ])));
}

// ── hero: cover, photo, name ────────────────────────────────────────────────

function renderHero(user) {
  const name = user.display_name || user.username;

  const cover = qs('[data-cover]');
  cover.classList.toggle('has-photo', Boolean(user.cover_url));
  cover.querySelector('.profile-hero__cover-img')?.remove();
  if (user.cover_url) {
    cover.prepend(createEl('img', { class: 'profile-hero__cover-img', src: user.cover_url, alt: '', decoding: 'async', referrerpolicy: 'no-referrer' }));
  }
  qs('[data-cover-change-label]').textContent = user.cover_url ? t('Change the cover') : t('Add a cover');
  qs('[data-cover-remove]').hidden = !user.cover_url;

  qs('[data-avatar-slot]').replaceChildren(avatar(name, { size: 'xl', url: user.avatar_url }));
  qs('[data-avatar-remove]').hidden = !user.avatar_url;

  qs('[data-hero-name]').textContent = name;
  const meta = qs('[data-hero-meta]');
  meta.replaceChildren(createEl('span', {}, `@${user.username}`));
  const chip = categoryChip(user.category);
  if (chip) meta.append(chip);
}

function initPhotos(getProfile, setProfile) {
  const errorEl = qs('[data-photo-error]');
  const busy = qs('[data-photo-busy]');

  const KINDS = {
    avatar: { width: 512, height: 512, round: true, title: () => t('Position your photo'), input: qs('[data-avatar-file]') },
    cover: { width: 1500, height: 500, round: false, title: () => t('Position your cover'), input: qs('[data-cover-file]') },
  };

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  async function run(kind, task) {
    showError('');
    busy.hidden = false;
    try {
      const { profile } = await task();
      setProfile(profile);
      return true;
    } catch (err) {
      showError(kind === 'avatar'
        ? errorMessage(err, 'Could not update your photo.')
        : errorMessage(err, 'Could not update your cover.'));
      return false;
    } finally {
      busy.hidden = true;
    }
  }

  for (const [kind, spec] of Object.entries(KINDS)) {
    spec.input.addEventListener('change', async () => {
      const file = spec.input.files?.[0];
      spec.input.value = '';
      if (!file) return;
      let cropped;
      try {
        cropped = await cropImage(file, { width: spec.width, height: spec.height, round: spec.round, title: spec.title() });
      } catch {
        showError(t('This picture can\'t be opened here. Use a JPEG, PNG or WebP image.'));
        return;
      }
      if (!cropped) return;
      const ok = await run(kind, () => api.profile.uploadPhoto(kind, cropped.blob));
      if (ok) celebrate(kind === 'avatar' ? qs('[data-avatar-slot]') : qs('[data-cover]'), { pieces: 18 });
    });
  }

  qs('[data-avatar-change]').addEventListener('click', () => KINDS.avatar.input.click());
  qs('[data-cover-change]').addEventListener('click', () => KINDS.cover.input.click());
  qs('[data-avatar-remove]').addEventListener('click', () => {
    if (!getProfile().avatar_url) return;
    if (!window.confirm(t('Remove your photo?'))) return;
    run('avatar', () => api.profile.removePhoto('avatar'));
  });
  qs('[data-cover-remove]').addEventListener('click', () => {
    if (!getProfile().cover_url) return;
    if (!window.confirm(t('Remove your cover?'))) return;
    run('cover', () => api.profile.removePhoto('cover'));
  });
}

// ── field of work ───────────────────────────────────────────────────────────

function renderCategoryOptions(container) {
  container.innerHTML = '';
  const choices = [{ value: '', icon: 'i-circle-dot', label: t('Not set') }, ...MEMBER_CATEGORIES];
  for (const choice of choices) {
    const id = `profile-category-${choice.value || 'none'}`;
    container.append(createEl('label', { class: 'choice-chip', for: id }, [
      createEl('input', { type: 'radio', name: 'category', value: choice.value, id }),
      createEl('span', { class: 'choice-chip__body' }, [icon(choice.icon, { size: 16 }), choice.label]),
    ]));
  }
}

function fillForm(form, user) {
  form.username.value = user.username || '';
  form.display_name.value = user.display_name || '';
  form.bio.value = user.bio || '';
  form.country.value = user.country || '';
  const category = form.querySelector(`input[name="category"][value="${user.category || ''}"]`);
  if (category) category.checked = true;
  form.show_online.checked = user.show_online !== false;
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

  renderCategoryOptions(qs('[data-category-options]'));

  let profile;
  try {
    ({ profile } = await api.profile.me());
  } catch (err) {
    errorEl.textContent = errorMessage(err, 'Could not load your profile.');
    errorEl.hidden = false;
    return;
  }

  function setProfile(updated) {
    profile = updated;
    updateCachedUser(updated);
    renderHero(updated);
    renderStats(updated);
    if (viewLink) viewLink.setAttribute('href', `/u/${updated.username}`);
  }

  fillForm(form, profile);
  setProfile(profile);
  initPhotos(() => profile, setProfile);
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
        bio: form.bio.value.trim() || null,
        category: form.querySelector('input[name="category"]:checked')?.value || null,
        show_online: form.show_online.checked,
        country: form.country.value.trim().toUpperCase() || null,
        language: form.language.value || null,
      });

      const languageChanged = updated.language !== profile.language;
      setProfile(updated);
      fillForm(form, updated);
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
