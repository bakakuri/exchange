// js/shared/creator-trust.js
// A creator's track record - how many proofs they approved or rejected by
// hand (creator_review_stats(), 020_verification_upgrades.sql) - shown as
// a small badge on task cards and a line on the task page, so members can
// see who actually pays before doing the work. Until a creator has
// reviewed a few proofs they are shown as new.

import { t, tn } from '../core/i18n.js';
import { createEl } from './dom.js';
import { icon } from './icons.js';

const MIN_REVIEWS = 3;

export function creatorTrust(stats) {
  const approved = Number(stats?.approved) || 0;
  const rejected = Number(stats?.rejected) || 0;
  const total = approved + rejected;
  if (total < MIN_REVIEWS) {
    return { level: 'new', label: t('New creator'), detail: t('This creator hasn’t reviewed enough proofs to show a rate yet.') };
  }
  const rate = Math.round((approved / total) * 100);
  return {
    level: rate >= 80 ? 'good' : rate >= 50 ? 'mixed' : 'poor',
    rate,
    label: t('{rate}% approved', { rate }),
    detail: tn(total, 'Approves {rate}% of proofs · {n} review', 'Approves {rate}% of proofs · {n} reviews', { rate }),
  };
}

const ICONS = { good: 'i-shield-check', mixed: 'i-shield-check', poor: 'i-shield-alert', new: 'i-sparkles' };

/** Compact badge for a task card. */
export function trustBadge(stats) {
  const trust = creatorTrust(stats);
  return createEl('span', { class: `trust-badge trust-badge--${trust.level}`, title: trust.detail }, [
    icon(ICONS[trust.level], { size: 13 }),
    trust.label,
  ]);
}

/** One line for the task page. */
export function trustLine(stats) {
  const trust = creatorTrust(stats);
  return createEl('p', { class: `trust-line trust-line--${trust.level}` }, [
    icon(ICONS[trust.level], { size: 16 }),
    createEl('span', {}, trust.detail),
  ]);
}

/** Badge for link-click tasks: no review, the reward is instant. */
export function instantBadge() {
  return createEl('span', { class: 'trust-badge trust-badge--instant', title: t('Checked automatically: open the page and keep it open for 15 seconds.') }, [
    icon('i-mouse-pointer-click', { size: 13 }),
    t('Instant reward'),
  ]);
}
