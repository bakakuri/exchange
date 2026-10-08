// js/shared/image-upload.js
// Prepares a proof screenshot in the browser before it is uploaded:
//   - the longest side is scaled down to 1600 px and the picture is
//     re-encoded as WebP (JPEG where the browser can't write WebP), so a
//     6 MB phone screenshot becomes a few hundred KB;
//   - re-drawing it drops EXIF data, including the photo's location;
//   - a data: URL is returned for the preview (the CSP allows data:
//     images, not blob: ones).
// The server checks the bytes again (verification.service.js).

const MAX_SIDE = 1600;
const MAX_BYTES = 1.8 * 1024 * 1024; // the API accepts 2 MB

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall back to <img> below (older Safari) */ }
  }
  const img = new Image();
  img.src = await readAsDataUrl(file);
  await img.decode();
  return img;
}

const encode = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * @returns {Promise<{ blob: Blob, previewUrl: string, width: number, height: number }>}
 * Rejects with an Error whose message is 'unsupported' when the file
 * isn't an image this browser can open (e.g. HEIC on Android Chrome).
 */
export async function prepareScreenshot(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('unsupported');

  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error('unsupported');
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  source.close?.();

  let blob = await encode(canvas, 'image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', 0.85);
  for (const quality of [0.7, 0.55]) {
    if (blob && blob.size <= MAX_BYTES) break;
    blob = await encode(canvas, blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg', quality);
  }
  if (!blob || blob.size > MAX_BYTES) throw new Error('too-large');

  return { blob, previewUrl: await readAsDataUrl(blob), width, height };
}
