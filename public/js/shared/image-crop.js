// js/shared/image-crop.js
// "Position your photo" before a profile picture or cover is uploaded:
// a dialog shows the picture in the exact frame it will have (a circle
// for the avatar, a 3:1 banner for the cover); the member drags it and
// zooms (slider, wheel, pinch or keyboard), then saves.
//
// The result is drawn at a fixed size (512 x 512 avatar, 1500 x 500
// cover) and encoded as WebP (JPEG where the browser can't write WebP).
// Re-drawing also drops the photo's EXIF data, location included.
// Previews use data: URLs - the CSP allows those, not blob: ones.

import { createEl } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';

const MAX_SOURCE_SIDE = 2400;
const MAX_ZOOM = 4;
const MAX_BYTES = 1.8 * 1024 * 1024;

async function loadSource(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('unsupported');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      const img = new Image();
      img.src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await img.decode();
      bitmap = img;
    } catch {
      throw new Error('unsupported');
    }
  }
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { canvas, url: canvas.toDataURL('image/jpeg', 0.9) };
}

const encode = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

async function render(source, crop, width, height) {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  let blob = await encode(out, 'image/webp', 0.86);
  if (!blob || blob.type !== 'image/webp') blob = await encode(out, 'image/jpeg', 0.88);
  for (const quality of [0.72, 0.58]) {
    if (blob && blob.size <= MAX_BYTES) break;
    blob = await encode(out, blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg', quality);
  }
  if (!blob || blob.size > MAX_BYTES) throw new Error('too-large');
  return { blob, previewUrl: out.toDataURL(blob.type, 0.8) };
}

/**
 * Opens the crop dialog for `file`.
 * @returns {Promise<{ blob: Blob, previewUrl: string } | null>} null when cancelled.
 * Rejects with Error('unsupported') for files this browser can't open.
 */
export async function cropImage(file, { width = 512, height = 512, round = false, title = '' } = {}) {
  const { canvas: source, url } = await loadSource(file);
  const iw = source.width;
  const ih = source.height;

  const img = createEl('img', { class: 'crop-stage__img', alt: '', draggable: 'false', src: url });
  const stage = createEl('div', {
    class: `crop-stage ${round ? 'crop-stage--round' : ''}`.trim(),
    tabindex: '0',
    role: 'application',
    'aria-label': t('Photo position. Drag or use the arrow keys to move it, + and - to zoom.'),
    style: `aspect-ratio: ${width} / ${height}`,
  }, [img, createEl('span', { class: 'crop-stage__frame', 'aria-hidden': 'true' })]);
  const zoom = createEl('input', {
    type: 'range', min: '1', max: String(MAX_ZOOM), step: '0.01', value: '1', 'aria-label': t('Zoom'),
  });
  const save = createEl('button', { type: 'button', class: 'btn btn--primary' }, t('Save picture'));
  const cancel = createEl('button', { type: 'button', class: 'btn btn--ghost' }, t('Cancel'));
  const error = createEl('p', { class: 'form-error', role: 'alert' });
  error.hidden = true;

  const dialog = createEl('dialog', { class: 'crop-dialog', 'aria-labelledby': 'crop-dialog-title' }, [
    createEl('div', { class: 'crop-dialog__box' }, [
      createEl('h2', { id: 'crop-dialog-title', class: 'crop-dialog__title' }, title || t('Position your photo')),
      stage,
      createEl('div', { class: 'crop-zoom' }, [icon('i-zoom-out', { size: 18 }), zoom, icon('i-zoom-in', { size: 18 })]),
      createEl('p', { class: 'form-hint crop-dialog__hint' }, [icon('i-move', { size: 14 }), t('Drag to move, zoom with the slider.')]),
      error,
      createEl('div', { class: 'crop-dialog__actions' }, [cancel, save]),
    ]),
  ]);
  document.body.append(dialog);

  // The view: the image point under the frame's centre, and the zoom.
  const view = { cx: iw / 2, cy: ih / 2, z: 1 };

  // Layout size, not getBoundingClientRect(): the dialog opens with a
  // scale animation, which would shrink the measured frame for a moment.
  const frame = () => ({ w: stage.clientWidth || 1, h: stage.clientHeight || 1 });
  const baseScale = ({ w, h }) => Math.max(w / iw, h / ih);

  function clamp() {
    const f = frame();
    const scale = baseScale(f) * view.z;
    const halfW = f.w / 2 / scale;
    const halfH = f.h / 2 / scale;
    view.cx = Math.min(Math.max(view.cx, halfW), iw - halfW);
    view.cy = Math.min(Math.max(view.cy, halfH), ih - halfH);
  }

  function draw() {
    clamp();
    const f = frame();
    const scale = baseScale(f) * view.z;
    img.style.width = `${iw * scale}px`;
    img.style.height = `${ih * scale}px`;
    img.style.transform = `translate(${f.w / 2 - view.cx * scale}px, ${f.h / 2 - view.cy * scale}px)`;
    zoom.value = String(view.z);
  }

  function setZoom(z) {
    view.z = Math.min(Math.max(z, 1), MAX_ZOOM);
    draw();
  }

  function moveBy(dx, dy) {
    const scale = baseScale(frame()) * view.z;
    view.cx -= dx / scale;
    view.cy -= dy / scale;
    draw();
  }

  // Drag with one pointer, pinch with two.
  const pointers = new Map();
  let pinch = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.classList.add('is-dragging');
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.z };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, now);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
    } else if (pointers.size === 1) {
      moveBy(now.x - last.x, now.y - last.y);
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) stage.classList.remove('is-dragging');
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(view.z * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); moveBy(...moves[e.key]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(view.z * 1.1); }
    else if (e.key === '-') { e.preventDefault(); setZoom(view.z / 1.1); }
  });
  zoom.addEventListener('input', () => setZoom(Number(zoom.value)));
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('resize', onResize);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };

    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(null); });
    save.addEventListener('click', async () => {
      save.disabled = true;
      error.hidden = true;
      clamp();
      const f = frame();
      const scale = baseScale(f) * view.z;
      const w = f.w / scale;
      const h = f.h / scale;
      try {
        finish(await render(source, { x: view.cx - w / 2, y: view.cy - h / 2, w, h }, width, height));
      } catch {
        error.textContent = t('That picture is too large even after compressing it. Try another one.');
        error.hidden = false;
        save.disabled = false;
      }
    });

    dialog.showModal();
    img.decode().catch(() => {}).finally(() => {
      draw();
      stage.focus({ preventScroll: true });
    });
  });
}
