// js/shared/task-types.js
// Mirrors server/constants/task-types.js (which mirrors task_type in
// 004_tasks.sql).

import { t } from '../core/i18n.js';

export const TASK_TYPES = [
  { value: 'follow', get label() { return t('Follow'); } },
  { value: 'like', get label() { return t('Like'); } },
  { value: 'comment', get label() { return t('Comment'); } },
  { value: 'subscribe', get label() { return t('Subscribe'); } },
  { value: 'share', get label() { return t('Share'); } },
  { value: 'repost', get label() { return t('Repost'); } },
  { value: 'save', get label() { return t('Save'); } },
  { value: 'join', get label() { return t('Join'); } },
  { value: 'visit', get label() { return t('Visit'); } },
  { value: 'view', get label() { return t('View'); } },
  { value: 'listen', get label() { return t('Listen'); } },
  { value: 'custom', get label() { return t('Custom'); } },
];

export function taskTypeLabel(value) {
  return TASK_TYPES.find((type) => type.value === value)?.label || value;
}
