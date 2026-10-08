// js/tasks/proof-form.js
// "Send proof" card on a task that a person checks by hand: a screenshot
// (picked from the gallery or taken with the camera, shrunk in the
// browser - shared/image-upload.js), a link and/or a note. At least one
// is needed. The screenshot is uploaded first (POST
// /api/verification/proof-image), then the submission references it.

import { api } from '../shared/api.js';
import { createEl } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { icon } from '../shared/icons.js';
import { prepareScreenshot } from '../shared/image-upload.js';
import { t, formatNumber } from '../core/i18n.js';

const AUTO_APPROVE_HOURS = 24;

function sizeLabel(bytes) {
  return bytes >= 1024 * 1024
    ? t('{size} MB', { size: formatNumber(Math.round((bytes / 1024 / 1024) * 10) / 10) })
    : t('{size} KB', { size: formatNumber(Math.max(1, Math.round(bytes / 1024))) });
}

function screenshotPicker(onChange) {
  const input = createEl('input', { type: 'file', id: 'proof-image', accept: 'image/*', class: 'visually-hidden' });
  const picker = createEl('label', { class: 'shot-picker', for: 'proof-image' }, [
    createEl('span', { class: 'shot-picker__icon' }, [icon('i-image-plus', { size: 22 })]),
    createEl('span', { class: 'shot-picker__text' }, [
      createEl('strong', {}, t('Add a screenshot')),
      createEl('small', {}, t('From your gallery or camera. We shrink it before sending.')),
    ]),
  ]);

  const img = createEl('img', { alt: t('Screenshot preview') });
  const caption = createEl('figcaption', {}, '');
  const remove = createEl('button', { type: 'button', class: 'icon-button shot-preview__remove', 'aria-label': t('Remove screenshot') },
    [icon('i-x', { size: 18 })]);
  const preview = createEl('figure', { class: 'shot-preview', hidden: '' }, [img, remove, caption]);
  const status = createEl('p', { class: 'shot-picker__status', role: 'status' }, '');

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    status.textContent = t('Preparing screenshot…');
    try {
      const shot = await prepareScreenshot(file);
      img.src = shot.previewUrl;
      caption.textContent = `${shot.width} × ${shot.height} · ${sizeLabel(shot.blob.size)}`;
      preview.hidden = false;
      picker.hidden = true;
      status.textContent = '';
      onChange(shot.blob);
    } catch (err) {
      status.textContent = err.message === 'too-large'
        ? t('That image is too large. Try a smaller screenshot.')
        : t('That file can’t be opened as an image. Use a JPEG, PNG or WebP screenshot.');
    }
  });

  remove.addEventListener('click', () => {
    preview.hidden = true;
    picker.hidden = false;
    img.removeAttribute('src');
    onChange(null);
    picker.focus();
  });

  return createEl('div', { class: 'field' }, [
    createEl('span', { class: 'field__label' }, t('Screenshot')),
    input, picker, preview, status,
  ]);
}

export function renderProofForm(task, onSubmitted) {
  let screenshot = null;

  const urlField = createEl('input', { type: 'url', id: 'proof-url', name: 'proof_url', placeholder: 'https://…', inputmode: 'url' });
  const textField = createEl('textarea', { id: 'proof-text', name: 'proof_text', rows: '3', maxlength: '2000' });
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const submitBtn = createEl('button', { type: 'submit', class: 'btn btn--primary btn--lg' }, t('Submit proof'));

  const form = createEl('form', { class: 'form proof-card', id: 'submit-proof-form', novalidate: '' }, [
    createEl('div', { class: 'proof-card__head' }, [
      createEl('h2', {}, t('Send proof')),
      createEl('p', {}, t('Add at least one: a screenshot, a link or a note.')),
    ]),
    screenshotPicker((blob) => { screenshot = blob; }),
    createEl('div', { class: 'field' }, [createEl('label', { for: 'proof-url' }, t('Proof URL (optional)')), urlField]),
    createEl('div', { class: 'field' }, [createEl('label', { for: 'proof-text' }, t('Proof notes (optional)')), textField]),
    errorEl,
    submitBtn,
    createEl('p', { class: 'proof-card__auto' }, [
      icon('i-clock', { size: 16 }),
      t('If the creator doesn’t review it within {hours} hours, it’s approved automatically.', { hours: AUTO_APPROVE_HOURS }),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const proofUrl = urlField.value.trim();
    const proofText = textField.value.trim();
    if (!screenshot && !proofUrl && !proofText) {
      errorEl.textContent = t('Add a link, a note or a screenshot as proof');
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    try {
      let proofImagePath;
      if (screenshot) {
        submitBtn.textContent = t('Uploading screenshot…');
        ({ path: proofImagePath } = await api.verification.uploadProofImage(screenshot));
      }
      submitBtn.textContent = t('Sending…');
      const { completion } = await api.verification.submit(task.id, {
        proof_url: proofUrl || undefined,
        proof_text: proofText || undefined,
        proof_image_path: proofImagePath,
      });
      onSubmitted(completion);
    } catch (err) {
      errorEl.textContent = errorMessage(err, 'Could not submit proof.');
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = t('Submit proof');
    }
  });

  return form;
}
