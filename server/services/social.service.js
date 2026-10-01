// server/services/social.service.js
// CRUD over public.social_profiles. Like profile.service.js, every call
// goes through the caller's own RLS-scoped client - 014_rls.sql's
// *_own policies are what actually stop one user from touching another
// user's linked accounts. Because RLS silently filters out rows that
// aren't the caller's rather than raising, an update/delete on someone
// else's id just affects zero rows; this file turns that into a clean
// 404 instead of leaking whether the id exists at all.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const { UPDATABLE_FIELDS } = require('../validators/social.validator');

const FIELDS = 'id, user_id, platform, username, profile_url, display_name, verification_state, created_at, updated_at';

function mapDbError(error) {
  if (error?.code === '23505') {
    return new AppError(ErrorCodes.VALIDATION_ERROR, 'You already linked an account for that platform and username', 409);
  }
  return new AppError(ErrorCodes.VALIDATION_ERROR, error?.message || 'Could not save the linked account', 400);
}

async function listForUser(accessToken, userId) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client
    .from('social_profiles')
    .select(FIELDS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw mapDbError(error);
  return data;
}

async function create(accessToken, userId, input) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client
    .from('social_profiles')
    .insert({
      user_id: userId,
      platform: input.platform,
      username: input.username,
      profile_url: input.profile_url,
      display_name: input.display_name ?? null,
    })
    .select(FIELDS)
    .single();

  if (error) throw mapDbError(error);
  return data;
}

async function update(accessToken, id, updates) {
  const patch = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in updates) patch[field] = updates[field];
  }

  const client = getClientForUser(accessToken);
  const { data, error } = await client
    .from('social_profiles')
    .update(patch)
    .eq('id', id)
    .select(FIELDS)
    .maybeSingle();

  if (error) throw mapDbError(error);
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Linked account not found', 404);
  return data;
}

async function remove(accessToken, id) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client
    .from('social_profiles')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) throw mapDbError(error);
  if (!data) throw new AppError(ErrorCodes.NOT_FOUND, 'Linked account not found', 404);
}

module.exports = { listForUser, create, update, remove };
