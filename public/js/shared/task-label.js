// js/shared/task-label.js
// One plain-language name for what a task asks you to do, e.g.
// "Follow on Instagram", "Subscribe on YouTube". Used wherever a task is
// listed so the same action reads the same way everywhere.

import { taskPlatformLabel } from './task-platforms.js';
import { taskTypeLabel } from './task-types.js';

export function taskActionLabel(taskType, platform) {
  const action = taskTypeLabel(taskType);
  if (!platform || platform === 'other') return taskType === 'custom' ? 'Custom task' : action;
  const where = taskPlatformLabel(platform);
  return taskType === 'custom' ? `${where} task` : `${action} on ${where}`;
}
