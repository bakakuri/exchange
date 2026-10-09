// js/messages/upload.js - getting a file ready and into Storage.
//   prepareFile(file)  -> { blob, name, type, kind, meta, previewUrl }
//       Big photos are scaled to 2048 px (JPEG) - quick to send, sharp on
//       any screen; small ones, GIFs and every other file go as they are.
//       Photos and videos get their size (and length) so the chat can keep
//       their place before they load.
//   uploadFile(url, blob, { onProgress, signal })
//       PUTs the bytes to the one-time signed upload URL the API made
//       (POST /api/messages/conversations/:id/uploads); there is no size
//       limit of our own - the Storage project setting is the only one.

import { kindOf } from './format.js';

const MAX_SIDE = 2048;
const RESIZE_OVER_BYTES = 1.5 * 1024 * 1024;

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const img = new Image();
    img.src = await readAsDataUrl(file);
    await img.decode();
    return img;
  }
}

async function preparePhoto(file) {
  let source;
  try {
    source = await decodeImage(file);
  } catch {
    return { blob: file, meta: {} };
  }
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const big = Math.max(width, height) > MAX_SIDE || file.size > RESIZE_OVER_BYTES;
  if (!big || file.type === 'image/gif') {
    source.close?.();
    return { blob: file, meta: { width, height } };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob || blob.size >= file.size) return { blob: file, meta: { width, height } };
  return { blob, meta: { width: canvas.width, height: canvas.height }, renamed: true };
}

// A video's length and size, if the browser can read them within 4 s.
function videoMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (meta) => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(meta);
    };
    const timer = setTimeout(() => done({}), 4000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const meta = {};
      if (Number.isFinite(video.duration)) meta.duration_ms = Math.round(video.duration * 1000);
      if (video.videoWidth) Object.assign(meta, { width: video.videoWidth, height: video.videoHeight });
      done(meta);
    };
    video.onerror = () => { clearTimeout(timer); done({}); };
    video.src = url;
  });
}

export async function prepareFile(file) {
  const kind = kindOf(file);
  let blob = file;
  let meta = {};
  let name = file.name || 'file';
  let previewUrl = null;

  if (kind === 'image') {
    const photo = await preparePhoto(file);
    blob = photo.blob;
    meta = photo.meta;
    if (photo.renamed) name = name.replace(/\.[^.]+$/, '') + '.jpg';
    previewUrl = await readAsDataUrl(blob).catch(() => null);
  } else if (kind === 'video') {
    meta = await videoMeta(file);
  }
  return { blob, name, type: blob.type || file.type || 'application/octet-stream', kind, meta, previewUrl };
}

/** Uploads to a signed URL. Resolves when stored; rejects with { status } or 'aborted'. */
export function uploadFile(url, blob, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Only Content-Type: Storage's CORS answer allows it (supabase-js sends
    // it the same way), and nothing else is needed.
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(Object.assign(new Error('upload failed'), { status: xhr.status })));
    xhr.onerror = () => reject(Object.assign(new Error('upload failed'), { status: 0 }));
    xhr.onabort = () => reject(new Error('aborted'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(blob);
  });
}
