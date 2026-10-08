// js/shared/time.js - dates for lists, in the active language.
//   timeAgo()        "2 hours ago" / "yesterday"
//   shortDateTime()  "Sep 30, 12:00 PM"
//   shortDate()      "Sep 30, 2026"
//   longDay()        "Wednesday, October 7"
//   fullDateTime()   for title tooltips
// Chrome (desktop and Android) ships without Georgian date data - Intl
// silently falls back to English there - so Georgian has its own small
// formatter below, used whenever the browser doesn't know "ka".

import { t, currentLanguage, currentLocale } from '../core/i18n.js';

const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

const knows = new Map();
const intlKnows = (locale) => {
  if (!knows.has(locale)) knows.set(locale, Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0);
  return knows.get(locale);
};
const useGeorgianFallback = () => currentLanguage() === 'ka' && !intlKnows('ka');

// ── Georgian fallback (CLDR "ka" patterns) ───────────────────────────────

const KA_MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
const KA_MONTHS_SHORT = ['იან.', 'თებ.', 'მარ.', 'აპრ.', 'მაი.', 'ივნ.', 'ივლ.', 'აგვ.', 'სექ.', 'ოქტ.', 'ნოე.', 'დეკ.'];
const KA_WEEKDAYS = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'];
const KA_UNITS = { minute: 'წუთის', hour: 'საათის', day: 'დღის', week: 'კვირის', month: 'თვის', year: 'წლის' };
const KA_LAST = { day: 'გუშინ', week: 'გასულ კვირას', month: 'გასულ თვეს', year: 'გასულ წელს' };

const pad = (n) => String(n).padStart(2, '0');
const kaTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function kaAgo(unit, count) {
  if (count === 1 && KA_LAST[unit]) return KA_LAST[unit];
  return `${count} ${KA_UNITS[unit]} წინ`;
}

// ── public ───────────────────────────────────────────────────────────────

const relative = new Map();
const relativeFormat = (locale) => {
  if (!relative.has(locale)) relative.set(locale, new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  return relative.get(locale);
};

export function timeAgo(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) < size) continue;
    const count = Math.round(seconds / size);
    if (useGeorgianFallback()) return count < 0 ? kaAgo(unit, -count) : shortDateTime(iso);
    return relativeFormat(currentLocale()).format(count, unit);
  }
  return t('just now');
}

export function shortDateTime(iso) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (useGeorgianFallback()) {
    return `${d.getDate()} ${KA_MONTHS_SHORT[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}, ${kaTime(d)}`;
  }
  return d.toLocaleString(currentLocale(), {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit',
  });
}

export function shortDate(iso) {
  const d = new Date(iso);
  if (useGeorgianFallback()) return `${d.getDate()} ${KA_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  return d.toLocaleDateString(currentLocale(), { dateStyle: 'medium' });
}

export function longDay(date = new Date()) {
  const d = new Date(date);
  if (useGeorgianFallback()) return `${KA_WEEKDAYS[d.getDay()]}, ${d.getDate()} ${KA_MONTHS[d.getMonth()]}`;
  return d.toLocaleDateString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fullDateTime(iso) {
  const d = new Date(iso);
  if (useGeorgianFallback()) return `${d.getDate()} ${KA_MONTHS[d.getMonth()]}, ${d.getFullYear()}, ${kaTime(d)}`;
  return d.toLocaleString(currentLocale());
}
