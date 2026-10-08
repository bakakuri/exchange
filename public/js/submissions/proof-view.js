// js/submissions/proof-view.js - the proof attached to a submission and
// the line under it that explains where it stands (auto-approval
// countdown, approved automatically, expired). Shared by /submissions
// (your own) and /submissions/review (proof sent to you).

import { createEl } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../core/i18n.js';
import { timeAgo } from '../shared/time.js';

const AUTO_APPROVE_MS = 24 * 60 * 60 * 1000;

export function renderProof(c) {
  const parts = [];
  if (c.proof_image_url) {
    parts.push(createEl('a', {
      class: 'proof-shot', href: c.proof_image_url, target: '_blank', rel: 'noopener noreferrer',
      title: t('Open the screenshot full size'),
    }, [createEl('img', { src: c.proof_image_url, alt: t('Proof screenshot'), loading: 'lazy' })]));
  }
  if (c.proof_url) {
    parts.push(createEl('a', { href: c.proof_url, target: '_blank', rel: 'noopener noreferrer' }, c.proof_url));
  }
  if (c.proof_text) {
    parts.push(createEl('p', { class: 'submission-card__proof-text' }, c.proof_text));
  }
  if (parts.length === 0) return null;
  return createEl('div', { class: 'submission-card__proof' }, parts);
}

/** "Approved automatically in 5 hours" etc.; null when there's nothing to add. */
export function statusDetail(c, { reviewer = false } = {}) {
  if (c.status === 'pending' && c.created_at) {
    const due = new Date(new Date(c.created_at).getTime() + AUTO_APPROVE_MS).toISOString();
    const text = reviewer
      ? t('Approved automatically {when} if you don’t review it.', { when: timeAgo(due) })
      : t('Approved automatically {when} if nobody reviews it.', { when: timeAgo(due) });
    return createEl('p', { class: 'submission-card__detail submission-card__detail--due' }, [icon('i-clock', { size: 14 }), text]);
  }
  if (c.status === 'approved' && c.auto_approved) {
    const text = c.link_clicked_at ? t('Checked automatically by link click.') : t('Approved automatically - not reviewed within 24 hours.');
    return createEl('p', { class: 'submission-card__detail' }, [icon('i-badge-check', { size: 14 }), text]);
  }
  if (c.status === 'expired') {
    return createEl('p', { class: 'submission-card__detail' }, [icon('i-hourglass', { size: 14 }),
      t('The campaign ended before your proof was reviewed.')]);
  }
  return null;
}
