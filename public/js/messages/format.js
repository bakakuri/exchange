// js/messages/format.js - words and numbers around messages: what a
// message is in one line (inbox, pop-ups), file sizes, durations, times
// and day labels, and which kind a picked file is.

import { t, currentLocale, currentLanguage } from '../core/i18n.js';
import { shortDate } from '../shared/time.js';

export const KIND_ICONS = {
  image: 'i-image',
  video: 'i-video',
  audio: 'i-music',
  voice: 'i-mic',
  file: 'i-file-text',
};

/** "0:07", "12:30", "1:02:03" */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "820 B", "1.4 MB" */
export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  const units = [t('B'), t('KB'), t('MB'), t('GB')];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString(currentLocale(), { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** What a message is, in one line - for the inbox and the pop-up. */
export function previewText(message) {
  if (!message) return '';
  if (message.deleted_at) return t('Message deleted');
  const caption = message.body ? `: ${message.body}` : '';
  switch (message.kind) {
    case 'image': return t('Photo') + caption;
    case 'video': return t('Video') + caption;
    case 'audio': return `${t('Audio')}: ${message.attachment_name || ''}`.trim();
    case 'voice': return t('Voice message ({duration})', { duration: formatDuration(message.meta?.duration_ms) });
    case 'file': return `${t('File')}: ${message.attachment_name || ''}`.trim();
    default: return message.body || '';
  }
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function timeOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  // Georgian and Russian use the 24-hour clock; Intl may not know "ka".
  if (currentLanguage() !== 'en') return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toLocaleTimeString(currentLocale(), { hour: 'numeric', minute: '2-digit' });
}

/** "14:05" - the time on a bubble. */
export function messageTime(iso) {
  return timeOf(new Date(iso));
}

/** Inbox times: "14:05" today, "Yesterday", the weekday this week, else the date. */
export function inboxTime(iso) {
  const date = new Date(iso);
  const now = new Date();
  if (sameDay(date, now)) return timeOf(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return t('Yesterday');
  if (now - date < 6 * 24 * 3600 * 1000) {
    const days = [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')];
    return days[date.getDay()];
  }
  return shortDate(iso);
}

/** Separator between days in a chat: "Today", "Yesterday", or the date. */
export function dayLabel(iso) {
  const date = new Date(iso);
  const now = new Date();
  if (sameDay(date, now)) return t('Today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return t('Yesterday');
  return shortDate(iso);
}

export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Photos the browser can show; others (HEIC...) travel as files.
const SHOWN_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** The kind of message a picked file becomes. */
export function kindOf(file) {
  const type = String(file?.type || '').toLowerCase();
  if (SHOWN_IMAGES.includes(type)) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'file';
}

/** A short text of 1-3 emoji only is shown large, without a bubble. */
export function isEmojiOnly(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 24) return false;
  const stripped = value.replace(/\s/g, '');
  const emoji = stripped.match(/\p{Extended_Pictographic}/gu) || [];
  return emoji.length > 0 && emoji.length <= 3
    && stripped.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣]/gu, '') === '';
}
