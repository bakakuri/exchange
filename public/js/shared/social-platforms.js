// js/shared/social-platforms.js
// Mirrors server/constants/social-platforms.js (which mirrors the
// social_platform enum in 002_social_profiles.sql) - all three have to
// agree; this is the copy the UI reads labels and select options from.

export const SOCIAL_PLATFORMS = [
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
];

export function platformLabel(value) {
  return SOCIAL_PLATFORMS.find((p) => p.value === value)?.label || value;
}
