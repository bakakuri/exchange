// js/submissions/status.js - shared between submissions.js and
// review-queue.js so a completion's status is labeled the same way in
// both places.

const LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
};

export function statusLabel(status) {
  return LABELS[status] || status;
}
