// js/submissions/status.js - shared between submissions.js and
// review-queue.js so a completion's status is labeled the same way in
// both places.

import { t } from '../core/i18n.js';

const LABELS = {
  pending: () => t('Pending'),
  approved: () => t('Approved'),
  rejected: () => t('Rejected'),
  expired: () => t('Expired'),
};

export function statusLabel(status) {
  return LABELS[status]?.() || status;
}
