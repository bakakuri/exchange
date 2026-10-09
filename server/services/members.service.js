// server/services/members.service.js
// The members directory (022_profiles_members_admin.sql). Everything goes
// through member_directory() / member_directory_counts() with the
// caller's own token: those functions decide what each caller may see of
// other members' presence (show_online), so nothing here can leak it.

const { getClientForUser } = require('../config/supabase');
const { AppError, ErrorCodes } = require('../utils/errors');

// member_directory()'s row -> the member object the API returns.
function toMember(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    bio: row.bio,
    category: row.category,
    country: row.country,
    role: row.role,
    level: row.level,
    xp: row.xp,
    created_at: row.created_at,
    // null = the member hides their status
    is_online: row.is_online,
    last_seen_at: row.last_seen_at,
    campaigns_count: row.campaigns_count,
    completed_count: row.completed_count,
    xp_rank: Number(row.xp_rank) || null,
  };
}

async function list(accessToken, { search, category, segment, sort, limit, offset }) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('member_directory', {
    p_search: search,
    p_category: category,
    p_segment: segment,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
    p_username: null,
  });
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  const rows = Array.isArray(data) ? data : [];
  const total = rows.length ? Number(rows[0].total_count) || 0 : 0;
  const nextOffset = offset + rows.length < total ? offset + rows.length : null;
  return { members: rows.map(toMember), total, next_offset: nextOffset };
}

async function counts(accessToken) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('member_directory_counts');
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  return data || {};
}

async function getByUsername(accessToken, username) {
  const client = getClientForUser(accessToken);
  const { data, error } = await client.rpc('member_directory', {
    p_search: null, p_category: null, p_segment: null, p_sort: null, p_limit: 1, p_offset: 0, p_username: username,
  });
  if (error) throw new AppError(ErrorCodes.DB_ERROR, error.message);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new AppError(ErrorCodes.NOT_FOUND, 'Member not found', 404);
  return toMember(row);
}

module.exports = { list, counts, getByUsername, toMember };
