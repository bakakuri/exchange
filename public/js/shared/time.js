// js/shared/time.js - short, locale-aware date labels for lists.
// timeAgo() gives "2 hours ago" / "yesterday"; shortDateTime() gives
// "Sep 30, 12:00 PM". Use fullDateTime() for a title tooltip.

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

export function timeAgo(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function shortDateTime(iso) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit',
  });
}

export const fullDateTime = (iso) => new Date(iso).toLocaleString();
