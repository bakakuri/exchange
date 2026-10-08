// js/campaigns/status.js - shared between campaigns.js and
// campaign-detail.js so a campaign's status is labeled the same way in
// both places (campaign_status enum, 003_campaigns.sql).

import { t } from '../core/i18n.js';

const LABELS = {
  active: () => t('Active'),
  paused: () => t('Paused'),
  completed: () => t('Completed'),
  cancelled: () => t('Cancelled'),
};

export function campaignStatusLabel(status) {
  return LABELS[status]?.() || status;
}
