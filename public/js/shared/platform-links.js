// js/shared/platform-links.js
// What a link points at, and what a profile link usually looks like:
//   detectPlatform('https://youtu.be/x')       -> 'youtube'
//   profileUrlFor('tiktok', '@nino')           -> 'https://www.tiktok.com/@nino'
// Used to fill in forms for the member; the server still checks the URL.

const HOSTS = [
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'youtube'],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.watch$/, 'facebook'],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, 'x'],
  [/(^|\.)t\.me$|(^|\.)telegram\.me$/, 'telegram'],
  [/(^|\.)discord\.gg$|(^|\.)discord\.com$/, 'discord'],
  [/(^|\.)twitch\.tv$/, 'twitch'],
  [/(^|\.)reddit\.com$|(^|\.)redd\.it$/, 'reddit'],
  [/(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, 'pinterest'],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, 'linkedin'],
];

/** The platform a URL belongs to, 'other' for any other site, null if it isn't a web link. */
export function detectPlatform(url) {
  let host;
  try {
    const parsed = new URL(String(url).trim());
    if (!/^https?:$/.test(parsed.protocol)) return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [re, platform] of HOSTS) if (re.test(host)) return platform;
  return 'other';
}

const PROFILE_URLS = {
  instagram: (u) => `https://instagram.com/${u}`,
  tiktok: (u) => `https://www.tiktok.com/@${u}`,
  youtube: (u) => `https://www.youtube.com/@${u}`,
  facebook: (u) => `https://facebook.com/${u}`,
  x: (u) => `https://x.com/${u}`,
  telegram: (u) => `https://t.me/${u}`,
  twitch: (u) => `https://twitch.tv/${u}`,
  reddit: (u) => `https://reddit.com/user/${u}`,
  pinterest: (u) => `https://pinterest.com/${u}`,
  linkedin: (u) => `https://linkedin.com/in/${u}`,
};

/** The usual profile link for a handle, or '' when there isn't one (Discord). */
export function profileUrlFor(platform, username) {
  const handle = String(username || '').trim().replace(/^@+/, '');
  if (!handle || !/^[\w.\-]+$/.test(handle) || !PROFILE_URLS[platform]) return '';
  return PROFILE_URLS[platform](handle);
}

/** "https://www.instagram.com/nino/?hl=en" -> "instagram.com/nino" */
export function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.hostname.replace(/^www\./, '') + parsed.pathname).replace(/\/$/, '');
  } catch {
    return String(url || '');
  }
}

// Actions done on one post or video, not on the account itself: the
// campaign needs that post's link.
export const POST_ACTIONS = ['like', 'comment', 'share', 'repost', 'save', 'view', 'listen'];
