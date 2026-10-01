// server/constants/task-platforms.js
// Mirrors the task_platform enum in 004_tasks.sql (a separate enum from
// social_platform - this one also has 'other', since a task's target
// isn't limited to the platforms someone can link a profile for).

module.exports = [
  'instagram', 'tiktok', 'youtube', 'facebook', 'x', 'telegram',
  'discord', 'twitch', 'reddit', 'pinterest', 'linkedin', 'other',
];
