// server/services/media.service.js
// Profile photos (022_profiles_members_admin.sql). The browser crops and
// resizes the picture (512 px square avatar, 1500 x 500 cover) and sends
// the bytes here; this file checks what they really are, stores them in
// the public "media" bucket as "<user id>/<kind>-<random>.<ext>", points
// the profile at the new file and deletes the one it replaces.
//
// profiles.avatar_url / cover_url are closed to members (022 revokes the
// column grant), so the service role writes them here, for the user the
// verified token belongs to - never for an id the client supplies.

const crypto = require('node:crypto');
const { supabaseAdmin } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const { sniffImage } = require('../utils/images');
const logger = require('../utils/logger');
const PROFILE_FIELDS = require('../constants/profile-fields');

const MEDIA_BUCKET = 'media';
const PUBLIC_MARKER = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
const PHOTO_COLUMNS = { avatar: 'avatar_url', cover: 'cover_url' };

function columnFor(kind) {
  const column = PHOTO_COLUMNS[kind];
  if (!column) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Unknown photo kind', 400);
  return column;
}

// The bucket's own public address, e.g.
// "https://<project>.supabase.co/storage/v1/object/public/media/".
function bucketBase() {
  return supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl('').data.publicUrl.replace(/\/?$/, '/');
}

// "<bucket base><owner id>/<kind>-<uuid>.<ext>" -> that path. Anything else
// - another site, another member's folder, a malformed address -> null, so
// only the owner's own photos can ever be deleted on their behalf.
function pathFromPublicUrl(url, ownerId) {
  if (typeof url !== 'string' || !ownerId) return null;
  const base = bucketBase();
  if (!url.startsWith(base) || !url.includes(PUBLIC_MARKER)) return null;
  let path;
  try {
    path = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const own = new RegExp(`^${ownerId}/(avatar|cover)-[0-9a-f-]{36}\\.(jpg|png|webp)$`);
  return own.test(path) ? path : null;
}

// Best effort: a file that can't be deleted is only logged - the profile
// no longer points at it either way.
async function deleteFiles(urls, ownerId) {
  const paths = [...new Set(urls.map((url) => pathFromPublicUrl(url, ownerId)).filter(Boolean))];
  if (paths.length === 0) return;
  const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).remove(paths);
  if (error) logger.warn('media cleanup failed', { message: error.message, count: paths.length });
}

async function readPhotos(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('avatar_url, cover_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Profile not found', 404);
  return data;
}

async function setPhoto(userId, column, url) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ [column]: url })
    .eq('id', userId)
    .select(PROFILE_FIELDS)
    .single();
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  return data;
}

async function uploadPhoto(userId, kind, buffer, contentType) {
  const column = columnFor(kind);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Choose an image to upload', 400);
  }
  const image = sniffImage(buffer);
  if (!image || image.type !== contentType) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Photos must be JPEG, PNG or WebP images', 400);
  }

  const before = await readPhotos(userId);

  const path = `${userId}/${kind}-${crypto.randomUUID()}.${image.ext}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .upload(path, buffer, { contentType: image.type, upsert: false, cacheControl: '31536000' });
  if (uploadError) throw new AppError(ErrorCodes.INTERNAL, `photo upload failed: ${uploadError.message}`);

  const { data } = supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  let profile;
  try {
    profile = await setPhoto(userId, column, data.publicUrl);
  } catch (err) {
    await deleteFiles([data.publicUrl], userId);
    throw err;
  }
  if (before[column] && before[column] !== data.publicUrl) await deleteFiles([before[column]], userId);
  return profile;
}

async function removePhoto(userId, kind) {
  const column = columnFor(kind);
  const before = await readPhotos(userId);
  const profile = await setPhoto(userId, column, null);
  if (before[column]) await deleteFiles([before[column]], userId);
  return profile;
}

module.exports = { uploadPhoto, removePhoto, deleteFiles, pathFromPublicUrl, MEDIA_BUCKET };
