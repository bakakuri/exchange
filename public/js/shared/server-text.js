// js/shared/server-text.js
// Text the database writes in English - notification titles and bodies,
// ledger descriptions, achievement names - shown in the active language.
// Exact strings go through the dictionary; the few with a number or a
// name inside are matched by pattern. Anything else (a reviewer's note,
// a campaign title) is someone's own words and is shown as written.

import { t, tn, hasTranslation } from '../core/i18n.js';

const PATTERNS = [
  [/^Your submission was approved and you earned (\d+) credits?\.$/,
    (m) => tn(Number(m[1]), 'Your submission was approved and you earned {n} credit.',
      'Your submission was approved and you earned {n} credits.')],
  [/^(.+) has reached its completion target\.$/s,
    (m) => t('{title} has reached its completion target.', { title: m[1] })],
  [/^Someone sent proof for (.+)\. Review it within 24 hours or it is approved automatically\.$/s,
    (m) => t('Someone sent proof for {title}. Review it within 24 hours or it is approved automatically.', { title: m[1] })],
  [/^An admin confirmed the action was undone\. (\d+) credits? were returned to you\.$/,
    (m) => tn(Number(m[1]), 'An admin confirmed the action was undone. {n} credit was returned to you.',
      'An admin confirmed the action was undone. {n} credits were returned to you.')],
];

export function serverText(text) {
  if (!text) return text;
  if (hasTranslation(text)) return t(text);
  for (const [re, render] of PATTERNS) {
    const match = re.exec(text);
    if (match) return render(match);
  }
  return text;
}
