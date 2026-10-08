// js/submissions/proof-view.js - the proof attached to a submission and
// the lines under it that explain where it stands (auto-approval
// countdown, approved automatically, expired, an appeal or an
// undone-action report and what came of it). Shared by /submissions
// (your own) and /submissions/review (proof sent to you), plus the small
// "explain why" form both use to reach an admin (021_trust_and_economy.sql).

import { createEl } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../core/i18n.js';
import { timeAgo } from '../shared/time.js';

const HOUR_MS = 60 * 60 * 1000;
const AUTO_APPROVE_MS = 24 * HOUR_MS;
const FOLLOW_UP_DAYS = 7;

const detail = (iconId, text, modifier = '') =>
  createEl('p', { class: `submission-card__detail${modifier ? ` submission-card__detail--${modifier}` : ''}` },
    [icon(iconId, { size: 14 }), text]);

export function renderProof(c) {
  const parts = [];
  if (c.account_username) {
    const handle = `@${c.account_username}`;
    parts.push(createEl('p', { class: 'proof-account' }, [
      icon('i-user-check', { size: 14 }),
      t('Done from'),
      ' ',
      c.account_url
        ? createEl('a', { href: c.account_url, target: '_blank', rel: 'noopener noreferrer' }, handle)
        : createEl('strong', {}, handle),
    ]));
  }
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
  if (c.status === 'pending') {
    // Members with many rejected proofs aren't approved automatically: their
    // proofs wait for a person and expire (expires_at instead of auto_approve_at).
    if (c.expires_at) {
      return detail('i-hourglass', reviewer
        ? t('This member’s proofs are often rejected, so it isn’t approved automatically. It expires {when} if you don’t review it.', { when: timeAgo(c.expires_at) })
        : t('Waiting for the creator’s review. It expires {when} if nobody reviews it - proofs from accounts with many rejections aren’t approved automatically.', { when: timeAgo(c.expires_at) }),
      'due');
    }
    const due = c.auto_approve_at
      || (c.created_at && new Date(new Date(c.created_at).getTime() + AUTO_APPROVE_MS).toISOString());
    if (!due) return null;
    return detail('i-clock', reviewer
      ? t('Approved automatically {when} if you don’t review it.', { when: timeAgo(due) })
      : t('Approved automatically {when} if nobody reviews it.', { when: timeAgo(due) }), 'due');
  }
  if (c.status === 'approved' && c.appeal_status === 'resolved') {
    return detail('i-scale', t('Approved on appeal by an admin.'));
  }
  if (c.status === 'approved' && c.undo_report_status === 'open') {
    return detail('i-flag', t('Reported as undone - an admin will look at it.'));
  }
  if (c.status === 'approved' && c.undo_report_status === 'dismissed') {
    return detail('i-flag', t('Report declined - the reward stays with the member.'));
  }
  if (c.status === 'approved' && c.auto_approved) {
    const text = c.link_clicked_at ? t('Checked automatically by link click.') : t('Approved automatically - not reviewed within 24 hours.');
    return detail('i-badge-check', text);
  }
  if (c.status === 'rejected' && c.appeal_status === 'open') {
    return detail('i-scale', t('Appeal sent - an admin will look at it.'));
  }
  if (c.status === 'rejected' && c.appeal_status === 'dismissed') {
    return detail('i-scale', t('Appeal declined - the rejection stays.'));
  }
  if (c.status === 'expired') {
    const waited = c.reviewed_at && c.created_at && new Date(c.reviewed_at) - new Date(c.created_at) >= 72 * HOUR_MS;
    return detail('i-hourglass', waited
      ? t('Not reviewed within 3 days.')
      : t('The campaign ended before your proof was reviewed.'));
  }
  if (c.status === 'reversed') {
    return detail('i-undo-2', reviewer
      ? t('The action was undone - the reward was returned to you.')
      : t('The action was undone - the reward was taken back.'));
  }
  return null;
}

/** Within the 7 days after `iso` that appeals and undone-action reports allow. */
export function withinFollowUpWindow(iso) {
  return Boolean(iso) && Date.now() - new Date(iso).getTime() < FOLLOW_UP_DAYS * 24 * HOUR_MS;
}

/**
 * A button that opens a short "explain why" form for an admin - an appeal
 * (member) or an undone-action report (creator). onSend(message) does the
 * call; a thrown error is shown under the form.
 */
export function followUpForm({ iconId, buttonLabel, intro, placeholder, sendLabel, onSend, errorText }) {
  const openBtn = createEl('button', { type: 'button', class: 'btn btn--ghost btn--sm follow-up__open' },
    [icon(iconId, { size: 16 }), buttonLabel]);
  const message = createEl('textarea', { rows: '3', maxlength: '1000', placeholder });
  const sendBtn = createEl('button', { type: 'button', class: 'btn btn--primary btn--sm' }, sendLabel);
  const cancelBtn = createEl('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, t('Cancel'));
  const errorEl = createEl('p', { class: 'form-error', role: 'alert', hidden: '' }, '');
  const form = createEl('div', { class: 'follow-up__form', hidden: '' }, [
    createEl('p', { class: 'follow-up__intro' }, intro),
    message,
    createEl('div', { class: 'follow-up__actions' }, [sendBtn, cancelBtn]),
    errorEl,
  ]);

  openBtn.addEventListener('click', () => {
    form.hidden = false;
    openBtn.hidden = true;
    message.focus();
  });
  cancelBtn.addEventListener('click', () => {
    form.hidden = true;
    openBtn.hidden = false;
    errorEl.hidden = true;
  });
  sendBtn.addEventListener('click', async () => {
    errorEl.hidden = true;
    const text = message.value.trim();
    if (text.length < 10) {
      errorEl.textContent = t('Explain in at least 10 characters');
      errorEl.hidden = false;
      return;
    }
    sendBtn.disabled = true;
    try {
      await onSend(text);
    } catch (err) {
      errorEl.textContent = errorText(err);
      errorEl.hidden = false;
      sendBtn.disabled = false;
    }
  });

  return createEl('div', { class: 'follow-up' }, [openBtn, form]);
}
