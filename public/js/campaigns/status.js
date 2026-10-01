// js/campaigns/status.js - shared between campaigns.js and
// campaign-detail.js so a campaign's status is labeled the same way in
// both places (campaign_status enum, 003_campaigns.sql).

const LABELS = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function campaignStatusLabel(status) {
  return LABELS[status] || status;
}
