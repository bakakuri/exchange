// js/shared/presence.js
// "Online" / "last seen" for a member, as member_directory() reports it
// (022): is_online null means the member keeps their status to themselves.

import { t } from '../core/i18n.js';
import { createEl } from './dom.js';
import { timeAgo } from './time.js';

/** { online, text } or null when the status is hidden or unknown. */
export function presenceOf(member) {
  if (!member || member.is_online == null) return null;
  if (member.is_online) return { online: true, text: t('Online') };
  if (!member.last_seen_at) return null;
  return { online: false, text: t('Last seen {time}', { time: timeAgo(member.last_seen_at) }) };
}

/** A line with a dot: green and "Online", or grey and "Last seen ...". */
export function presenceLine(member, { className = '' } = {}) {
  const presence = presenceOf(member);
  if (!presence) return null;
  return createEl('span', { class: `presence ${presence.online ? 'presence--online' : ''} ${className}`.trim() }, [
    createEl('span', { class: 'presence__dot', 'aria-hidden': 'true' }),
    presence.text,
  ]);
}
