// js/shared/task-platforms.js
// Mirrors server/constants/task-platforms.js (which mirrors task_platform
// in 004_tasks.sql) - a separate enum from social_platform, so a
// separate file, even though most values overlap.

export const TASK_PLATFORMS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'X' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'twitch', label: 'Twitch' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'other', label: 'Other' },
];

export function taskPlatformLabel(value) {
  return TASK_PLATFORMS.find((p) => p.value === value)?.label || value;
}
