// server/constants/member-categories.js
// A member's field of work. Mirrors the profile_category_known check in
// 022_profiles_members_admin.sql and public/js/shared/member-categories.js.

const MEMBER_CATEGORIES = [
  'blogger', 'musician', 'business', 'artist', 'gamer',
  'sports', 'education', 'tech', 'photographer', 'other',
];

// Automatic groups of the members directory (member_directory()).
const MEMBER_SEGMENTS = ['online', 'creators', 'doers', 'new', 'top', 'admins'];
const MEMBER_SORTS = ['active', 'new', 'level'];

module.exports = { MEMBER_CATEGORIES, MEMBER_SEGMENTS, MEMBER_SORTS };
