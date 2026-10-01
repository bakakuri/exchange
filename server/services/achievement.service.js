// server/services/achievement.service.js
// Read-only: the static achievement catalog, and who has unlocked what.
// Nothing here ever unlocks an achievement - every user_achievements row
// is inserted by check_achievements() (015_functions.sql) after a real
// event (an approved completion, a campaign created, credits earned),
// never by a client request. Both tables are public to any authenticated
// caller (achievements_select_all, user_achievements_select_all,
// 014_rls.sql) - the same "display feed, not private data" shape as
// activity.service.js, so listUnlockedForUser() needs no owner check of
// its own.
//
// Neither table grows without bound the way notifications/activity/the
// ledger do - the catalog is a short, fixed list and a user can only
// ever unlock each achievement once (unique(user_id, achievement_id),
// 010_achievements.sql) - so unlike every other list in this codebase,
// there's no cursor pagination here.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

const CATALOG_FIELDS = 'id, code, title, description, created_at';
const UNLOCK_FIELDS = 'unlocked_at, achievement:achievements(id, code, title, description)';

async function listCatalog(accessToken) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client.from('achievements').select(CATALOG_FIELDS).order('created_at', { ascending: true });
  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  return { achievements: data };
}

async function listUnlockedForUser(accessToken, userId) {
  const client = getClientForUser(accessToken);

  const { data, error } = await client
    .from('user_achievements')
    .select(UNLOCK_FIELDS)
    .eq('user_id', userId)
    .order('unlocked_at', { ascending: false });

  if (error) throw new AppError(ErrorCodes.VALIDATION_ERROR, error.message, 400);
  return { unlocked: data };
}

module.exports = { listCatalog, listUnlockedForUser };
