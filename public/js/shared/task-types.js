// js/shared/task-types.js
// Mirrors server/constants/task-types.js (which mirrors task_type in
// 004_tasks.sql).

export const TASK_TYPES = [
  { value: 'follow', label: 'Follow' },
  { value: 'like', label: 'Like' },
  { value: 'comment', label: 'Comment' },
  { value: 'subscribe', label: 'Subscribe' },
  { value: 'share', label: 'Share' },
  { value: 'repost', label: 'Repost' },
  { value: 'save', label: 'Save' },
  { value: 'join', label: 'Join' },
  { value: 'visit', label: 'Visit' },
  { value: 'view', label: 'View' },
  { value: 'listen', label: 'Listen' },
  { value: 'custom', label: 'Custom' },
];

export function taskTypeLabel(value) {
  return TASK_TYPES.find((t) => t.value === value)?.label || value;
}
