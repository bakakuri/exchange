// js/shared/member-categories.js
// A member's field of work - mirrors server/constants/member-categories.js
// and the profile_category_known check (022_profiles_members_admin.sql).

import { t } from '../core/i18n.js';
import { createEl } from './dom.js';
import { icon } from './icons.js';

export const MEMBER_CATEGORIES = [
  { value: 'blogger', icon: 'i-pen-line', get label() { return t('Blogger'); } },
  { value: 'musician', icon: 'i-music', get label() { return t('Musician'); } },
  { value: 'business', icon: 'i-briefcase', get label() { return t('Business'); } },
  { value: 'artist', icon: 'i-palette', get label() { return t('Artist'); } },
  { value: 'gamer', icon: 'i-gamepad-2', get label() { return t('Gamer'); } },
  { value: 'sports', icon: 'i-trophy', get label() { return t('Sports'); } },
  { value: 'education', icon: 'i-graduation-cap', get label() { return t('Education'); } },
  { value: 'tech', icon: 'i-code-xml', get label() { return t('Tech'); } },
  { value: 'photographer', icon: 'i-camera', get label() { return t('Photographer'); } },
  { value: 'other', icon: 'i-sparkles', get label() { return t('Other'); } },
];

const byValue = (value) => MEMBER_CATEGORIES.find((c) => c.value === value);

export const categoryLabel = (value) => byValue(value)?.label || '';

/** A small chip: the field's icon and name; null when there is none. */
export function categoryChip(value, { className = '' } = {}) {
  const category = byValue(value);
  if (!category) return null;
  return createEl('span', { class: `category-chip category-chip--${category.value} ${className}`.trim() }, [
    icon(category.icon, { size: 14 }),
    category.label,
  ]);
}
