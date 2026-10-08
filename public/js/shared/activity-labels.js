// js/shared/activity-labels.js - activity_type names (009_activity.sql),
// for the dashboard feed and public profiles.

import { t } from '../core/i18n.js';

const LABELS = {
  task_completed: () => t('Task completed'),
  reward_earned: () => t('Reward earned'),
  campaign_created: () => t('Campaign created'),
  campaign_completed: () => t('Campaign completed'),
  verification_submitted: () => t('Proof submitted'),
  verification_reviewed: () => t('Proof reviewed'),
  achievement_unlocked: () => t('Achievement unlocked'),
  referral_joined: () => t('Friend joined'),
};

export function activityLabel(type) {
  return LABELS[type]?.() || String(type).replace(/_/g, ' ');
}
