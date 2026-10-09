// js/admin/admin-tabs.js
// The admin sections, shown at the top of every admin page. Each page's
// fragment has an empty <nav data-admin-tabs>; mountAdminTabs() fills it
// and marks the current section.

import { qs, createEl } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../core/i18n.js';

const TABS = [
  { href: '/admin', icon: 'i-layers', label: () => t('Overview') },
  { href: '/admin/campaigns', icon: 'i-megaphone', label: () => t('Campaigns') },
  { href: '/admin/submissions', icon: 'i-clipboard-check', label: () => t('Submissions') },
  { href: '/admin/reports', icon: 'i-flag', label: () => t('Reports') },
  { href: '/admin/messages', icon: 'i-send', label: () => t('Messages') },
];

export function mountAdminTabs() {
  const nav = qs('[data-admin-tabs]');
  if (!nav) return;
  const path = location.pathname;
  // /admin/users/:id belongs to the overview (the member list lives there).
  const current = TABS.slice(1).find((tab) => path === tab.href || path.startsWith(`${tab.href}/`))?.href || '/admin';
  nav.replaceChildren(...TABS.map((tab) => createEl('a', {
    href: tab.href,
    'data-link': '',
    class: 'admin-tab',
    ...(tab.href === current ? { 'aria-current': 'page' } : {}),
  }, [icon(tab.icon, { size: 16 }), createEl('span', {}, tab.label())])));
}
