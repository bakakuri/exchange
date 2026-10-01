// server/services/auth.service.js
// The one place that talks to Supabase Auth (GoTrue). Controllers never
// call supabase-js directly - they call this service, which normalizes
// Supabase's own errors into the platform's AppError/ErrorCodes and
// always hands back the same user shape (auth identity + profile
// merged), so the frontend never has to know Supabase's raw auth user
// shape is different from our profiles row.

const { supabaseAnon, supabaseAdmin, getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');
const PROFILE_FIELDS = require('../constants/profile-fields');

function mapAuthError(error) {
  const message = error?.message || 'Authentication failed';
  if (/already registered|already exists/i.test(message)) {
    return new AppError(ErrorCodes.VALIDATION_ERROR, 'An account with this email already exists', 409);
  }
  if (/invalid login credentials/i.test(message)) {
    return new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password', 401);
  }
  if (/rate limit/i.test(message)) {
    return new AppError(ErrorCodes.RATE_LIMITED, message, 429);
  }
  return new AppError(ErrorCodes.VALIDATION_ERROR, message, 400);
}

// The one place the Supabase auth user and our profiles row are merged
// into the "user" object every auth endpoint returns.
async function buildUserPayload(authUser) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', authUser.id)
    .single();
  if (error || !profile) return null;
  return { id: authUser.id, email: authUser.email, ...profile };
}

async function register({ email, password, username, referral_code }) {
  const { data, error } = await supabaseAnon.auth.signUp({ email, password });
  if (error) throw mapAuthError(error);

  // handle_new_user() (001/011_*.sql) has already created the profile
  // row by this point - it runs as a trigger on the auth.users insert
  // that signUp performs. If the caller chose a username or has a
  // referral code, apply those now as the freshly created user.
  let referralWarning;

  if (data.session && username) {
    const client = getClientForUser(data.session.access_token);
    const { error: updateError } = await client.from('profiles').update({ username }).eq('id', data.user.id);
    if (updateError) throw mapAuthError(updateError);
  }

  if (data.session && referral_code) {
    const client = getClientForUser(data.session.access_token);
    const { error: referralError } = await client.rpc('claim_referral', { p_code: referral_code });
    // A bad/self referral code should not block account creation -
    // surface it as a warning the caller can show, not a hard failure.
    if (referralError) referralWarning = referralError.message;
  }

  const user = data.session ? await buildUserPayload(data.user) : null;
  return { user, session: data.session, referralWarning };
}

async function login({ email, password }) {
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error) throw mapAuthError(error);
  return { user: await buildUserPayload(data.user), session: data.session };
}

async function logout(accessToken) {
  const client = getClientForUser(accessToken);
  const { error } = await client.auth.signOut();
  if (error) throw mapAuthError(error);
}

async function refresh(refreshToken) {
  const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw mapAuthError(error);
  return { user: await buildUserPayload(data.user), session: data.session };
}

async function requestPasswordReset(email) {
  const { error } = await supabaseAnon.auth.resetPasswordForEmail(email);
  if (error) throw mapAuthError(error);
}

async function confirmPasswordReset(accessToken, password) {
  const client = getClientForUser(accessToken);
  const { error } = await client.auth.updateUser({ password });
  if (error) throw mapAuthError(error);
}

// Used by middleware/auth.js on every authenticated request: verifies
// the token with Supabase and loads the matching profile row - the
// single source of truth for authorization, never a JWT claim the
// client could be stale or wrong about.
async function getUserFromToken(accessToken) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return buildUserPayload(data.user);
}

module.exports = {
  register,
  login,
  logout,
  refresh,
  requestPasswordReset,
  confirmPasswordReset,
  getUserFromToken,
};
