// server/services/profile.service.js
// Reads and updates public.profiles. Every call goes through the
// caller's own RLS-scoped client (getClientForUser), never
// supabaseAdmin - the database's own column-level grants and row
// policies (014_rls.sql) are the real authority here; this file just
// shapes requests/responses and turns Postgres errors into AppErrors.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const { UPDATABLE_FIELDS } = require('../validators/profile.validator');
const PROFILE_FIELDS = require('../constants/profile-fields');

function mapDbError(error) {
  if (error?.code === '23505') {
    return new AppError(ErrorCodes.VALIDATION_ERROR, 'That username is already taken', 409);
  }
  return new AppError(ErrorCodes.VALIDATION_ERROR, error?.message || 'Could not update profile', 400);
}

async function updateOwnProfile(userId, accessToken, updates) {
  const patch = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in updates) patch[field] = updates[field];
  }

  const client = getClientForUser(accessToken);
  const { data, error } = await client
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(PROFILE_FIELDS)
    .single();

  if (error) throw mapDbError(error);
  return data;
}

async function getProfileByUsername(accessToken, username) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('username', username)
    .maybeSingle();

  if (error) throw mapDbError(error);
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Profile not found', 404);
  return data;
}

module.exports = { updateOwnProfile, getProfileByUsername };
