// server/services/presence.service.js
// "Online" / "last seen" (022_profiles_members_admin.sql). Every signed-in
// request counts as activity: requireAuth calls touch(), which writes at
// most once a minute per member from this instance (the database ignores
// anything more frequent too). The page also pings POST /api/presence
// every two minutes while it is open and visible.
//
// Who may see it is decided by member_directory(), which honours each
// member's show_online setting - this file only records it.

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const TOUCH_EVERY_MS = 60_000;
const MAX_TRACKED = 5_000;
const lastTouch = new Map();

async function touch(userId) {
  if (!userId) return;
  const now = Date.now();
  if (now - (lastTouch.get(userId) || 0) < TOUCH_EVERY_MS) return;
  lastTouch.set(userId, now);
  if (lastTouch.size > MAX_TRACKED) {
    for (const [id, at] of lastTouch) {
      if (now - at >= TOUCH_EVERY_MS) lastTouch.delete(id);
    }
  }
  try {
    const { error } = await supabaseAdmin.rpc('touch_presence', { p_user_id: userId });
    if (error) logger.warn('presence update failed', { message: error.message });
  } catch (err) {
    // Never let presence break the request it rides on.
    logger.warn('presence update failed', { message: err?.message });
  }
}

module.exports = { touch, TOUCH_EVERY_MS };
