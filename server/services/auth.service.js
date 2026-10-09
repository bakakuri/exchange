// server/services/auth.service.js
// The one place that talks to Supabase Auth (GoTrue). Controllers never
// call supabase-js directly - they call this service, which normalizes
// Supabase's own errors into the platform's AppError/ErrorCodes and
// always hands back the same user shape (auth identity + profile
// merged), so the frontend never has to know Supabase's raw auth user
// shape is different from our profiles row.

const { createAuthClient, supabaseAdmin, getClientForUser } = require('../config/supabase');
const { config } = require('../config/env');
const { AppError, ErrorCodes } = require('../utils/errors');
const PROFILE_FIELDS = require('../constants/profile-fields');

// NOTE on supabase-js v2: a client built by getClientForUser() carries the
// user's token only as a global Authorization header - it has no stored
// session. auth.getUser() and PostgREST/RPC calls work with that, but
// auth.updateUser() throws "Auth session missing" and auth.signOut() is a
// silent no-op. Anything that changes the auth user therefore goes
// through the admin API below, after the token has been verified.

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
//
// If the code is deployed before migration 022 has been run, the new
// profile columns don't exist yet (Postgres error 42703). Signing in must
// keep working in that window, so the columns that existed before 022 are
// read instead.
const PRE_022_PROFILE_FIELDS =
  'id, username, display_name, avatar_url, bio, country, language, role, status, xp, level, credits, referral_code, created_at';

async function buildUserPayload(authUser) {
  const read = (fields) => supabaseAdmin.from('profiles').select(fields).eq('id', authUser.id).single();
  let { data: profile, error } = await read(PROFILE_FIELDS);
  if (error?.code === '42703') ({ data: profile, error } = await read(PRE_022_PROFILE_FIELDS));
  if (error || !profile) return null;
  return { id: authUser.id, email: authUser.email, ...profile };
}

// claim_referral() resolves the caller from auth.uid(), so it can only run
// with the user's own token. Failures never block sign-up/sign-in - a bad
// or self referral code becomes a warning the caller can show.
async function claimReferral(accessToken, code) {
  const client = getClientForUser(accessToken);
  const { error } = await client.rpc('claim_referral', { p_code: code });
  return error ? error.message : undefined;
}

async function register({ email, password, username, referral_code }) {
  const code = referral_code ? String(referral_code).trim().toUpperCase() : undefined;

  // With email confirmation on (Supabase's default) signUp returns no
  // session, so a referral code can't be claimed yet. It is parked in the
  // user's metadata and claimed on first sign-in (see login()).
  const { data, error } = await createAuthClient().auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${config.appUrl}/login`,
      data: code ? { pending_referral_code: code } : {},
    },
  });
  if (error) throw mapAuthError(error);

  // handle_new_user() (001/011_*.sql) has already created the profile row
  // by this point - it runs as a trigger on the auth.users insert that
  // signUp performs.
  //
  // Only touch the profile when this really is a brand-new account:
  //  - an already-confirmed email comes back as an obfuscated user with an
  //    empty identities list;
  //  - an existing but still-unconfirmed email comes back as the REAL user
  //    (identities included), so also require that the account was created
  //    just now - otherwise a re-sign-up could rename someone's pending
  //    account.
  const createdAt = Date.parse(data.user?.created_at || '');
  const isNewUser = Boolean(data.user?.id)
    && (data.user.identities?.length ?? 0) > 0
    && Number.isFinite(createdAt)
    && Date.now() - createdAt < 60_000;
  const warnings = {};

  // The username is applied with the admin client because there may be no
  // session yet. Format was already validated (auth.validator.js); a taken
  // username keeps the auto-generated one instead of failing a sign-up
  // whose account already exists.
  if (isNewUser && username) {
    const { error: updateError } = await supabaseAdmin
      .from('profiles').update({ username }).eq('id', data.user.id);
    if (updateError) {
      warnings.usernameWarning = /duplicate|unique/i.test(updateError.message)
        ? 'That username is taken - a default one was assigned. You can change it in your profile.'
        : 'Could not set that username - a default one was assigned.';
    }
  }

  if (data.session && code) {
    warnings.referralWarning = await claimReferral(data.session.access_token, code);
    await clearPendingReferral(data.user.id);
  }

  const user = data.session ? await buildUserPayload(data.user) : null;
  return { user, session: data.session, ...warnings };
}

async function clearPendingReferral(userId) {
  // GoTrue merges user_metadata keys; null removes the key.
  await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { pending_referral_code: null },
  });
}

async function login({ email, password }) {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error) throw mapAuthError(error);

  // First sign-in after an email-confirmed sign-up: claim the referral
  // code that register() parked in metadata, then clear it so this runs
  // at most once whatever the outcome.
  let referralWarning;
  const pending = data.user?.user_metadata?.pending_referral_code;
  if (pending && data.session) {
    referralWarning = await claimReferral(data.session.access_token, pending);
    await clearPendingReferral(data.user.id);
  }

  return { user: await buildUserPayload(data.user), session: data.session, referralWarning };
}

async function logout(accessToken) {
  // admin.signOut() revokes the refresh tokens behind this access token
  // (scope 'global' = every device), which client.auth.signOut() can't do
  // without a stored session.
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, 'global');
  if (error) throw mapAuthError(error);
}

async function refresh(refreshToken) {
  const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw mapAuthError(error);
  return { user: await buildUserPayload(data.user), session: data.session };
}

async function requestPasswordReset(email) {
  // The emailed link must land on /password-reset - that page reads the
  // #access_token=...&type=recovery fragment and shows the new-password
  // form. Without redirectTo Supabase sends people to the Site URL root,
  // where nothing handles the token. (The URL must also be allowed under
  // Supabase -> Authentication -> URL Configuration -> Redirect URLs.)
  const { error } = await createAuthClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${config.appUrl}/password-reset`,
  });
  if (error) throw mapAuthError(error);
}

async function confirmPasswordReset(accessToken, password) {
  // Verify the recovery token with Supabase first (signature + expiry);
  // only then change the password of exactly that user via the admin API.
  const { data, error: tokenError } = await createAuthClient().auth.getUser(accessToken);
  if (tokenError || !data?.user) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, 'This reset link is invalid or has expired', 401);
  }
  const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password });
  if (error) throw mapAuthError(error);
}

// Used by middleware/auth.js on every authenticated request: verifies
// the token with Supabase and loads the matching profile row - the
// single source of truth for authorization, never a JWT claim the
// client could be stale or wrong about.
async function getUserFromToken(accessToken) {
  // Passing the JWT explicitly verifies it against GoTrue on every
  // supabase-js v2 release (the header-only form needs a newer auth-js).
  const { data, error } = await createAuthClient().auth.getUser(accessToken);
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
