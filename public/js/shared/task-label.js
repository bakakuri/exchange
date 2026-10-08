// js/shared/task-label.js
// One plain-language name for what a task asks you to do, e.g.
// "Follow on Instagram", "Subscribe on YouTube". Used wherever a task is
// listed so the same action reads the same way everywhere.

import { taskPlatformLabel } from './task-platforms.js';
import { taskTypeLabel } from './task-types.js';
import { t } from '../core/i18n.js';

export function taskActionLabel(taskType, platform) {
  const action = taskTypeLabel(taskType);
  if (!platform || platform === 'other') return taskType === 'custom' ? t('Custom task') : action;
  const where = taskPlatformLabel(platform);
  return taskType === 'custom' ? t('{platform} task', { platform: where }) : t('{action} on {platform}', { action, platform: where });
}
