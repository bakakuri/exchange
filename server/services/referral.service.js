// server/services/referral.service.js
// Referrals (Stage 13). All the mechanics - generating a code on signup,
// claim_referral() recording who referred whom, try_reward_referral()
// paying out the bonus on the referred user's first approved completion -
// were already built and tested back in Stage 2 (011_referrals.sql,
// 015_functions.sql). This is only the missing API layer: claiming a
// code, and listing the referrals the caller is a party to.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const REFERRAL_FIELDS = 'id, referrer_id, referred_id, status, reward_issued_at, created_at';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

async function claim(accessToken, code) {
  const client = getClientForUser(accessToken);

  // Normalized to uppercase here, not in the validator - the validator only
  // checks shape, the service decides how the value reaches the database.
  const { error } = await client.rpc('claim_referral', { p_code: String(code).toUpperCase() });
  if (error) throw mapRpcError(error);
}

// referrals_select_participant (014_rls.sql) also lets an admin see every
// referral on the platform, not just their own - the same shape
// get_credit_summary() (Stage 10) exists specifically to avoid. Without
// this explicit .or() filter, "my referrals" called by an admin would
// silently return the whole table instead of the admin's own rows.
async function listMine(accessToken, userId, { limit, before } = {}) {
  const pageSize = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const client = getClientForUser(accessToken);

  let query = client
    .from('referrals')
    .select(REFERRAL_FIELDS)
    .or(`referrer_id.eq.${userId},referred_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);

  // Resolve only the "other party" per row to a username/display_name -
  // the caller already knows their own identity. Done as a plain second
  // .in() query rather than a nested PostgREST embed: referrals has two
  // foreign keys into profiles (referrer_id and referred_id), and
  // disambiguating a same-table double embed needs FK-hint syntax that
  // can't be exercised against the local Postgres stub (no PostgREST
  // layer there) - not worth the risk of shipping unverified.
  const otherIds = [...new Set(data.map((r) => (r.referrer_id === userId ? r.referred_id : r.referrer_id)))];

  let profilesById = {};
  if (otherIds.length > 0) {
    const { data: profiles, error: profilesError } = await client
      .from('profiles')
      .select('id, username, display_name')
      .in('id', otherIds);
    if (profilesError) throw new AppError(ErrorCodes.VALIDATION_ERROR, profilesError.message, 400);
    profilesById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  }

  const referrals = data.map((r) => {
    const direction = r.referrer_id === userId ? 'referrer' : 'referred';
    const otherId = direction === 'referrer' ? r.referred_id : r.referrer_id;
    return {
      id: r.id,
      status: r.status,
      reward_issued_at: r.reward_issued_at,
      created_at: r.created_at,
      direction,
      other_user: profilesById[otherId] || null,
    };
  });

  const nextCursor = data.length === pageSize ? data[data.length - 1].created_at : null;
  return { referrals, next_cursor: nextCursor };
}

// claim_referral() only ever raises UNAUTHORIZED or VALIDATION_ERROR
// (015_functions.sql) - both already exist in server/utils/errors.js, so
// no new ErrorCodes entries were needed for this stage.
function mapRpcError(error) {
  const match = /^([A-Z_]+):\s*(.*)$/.exec(error.message || '');
  if (match && ErrorCodes[match[1]]) return new AppError(match[1], match[2]);
  return new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
}

module.exports = { claim, listMine };
