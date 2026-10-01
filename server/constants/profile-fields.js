// server/constants/profile-fields.js
// The single canonical list of public.profiles columns returned to
// clients as a "user"/"profile" object. auth.service.js (identity) and
// profile.service.js (profile CRUD) both select exactly this, so every
// endpoint that hands back a user/profile - /auth/session, /auth/login,
// /profile/me, /profile/:username - agrees on the same shape. Add a
// column here, once, when a later stage needs to expose one.

// referral_code was added to public.profiles back in Stage 2
// (011_referrals.sql, auto-assigned by handle_new_user() on signup) but
// never actually reached a client until Stage 13 added it here - before
// that, a user had no way to see their own code to share it at all. Not
// a security gap: profiles_select_all (014_rls.sql) already grants
// blanket SELECT on every column to any authenticated caller, so this
// is purely an API-shaping omission, not RLS catching up to something.
// referred_by is deliberately left out - "who referred me" is already
// derivable from GET /api/referrals/mine without exposing a second raw
// foreign key here.
module.exports =
  'id, username, display_name, avatar_url, bio, country, language, role, status, xp, level, credits, referral_code, created_at';
