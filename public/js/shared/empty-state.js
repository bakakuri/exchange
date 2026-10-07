// js/shared/empty-state.js
// The one way to tell someone a list is empty: an icon, what's missing,
// why, and (when there is one) the next thing to do. Returned as an <li>
// so it sits inside the list it describes; pass { as: 'div' } elsewhere.

import { createEl } from './dom.js';
import { icon } from './icons.js';

export function emptyState({ iconId, title, text, action, as = 'li', className = '' }) {
  const children = [icon(iconId, { size: 24 }), createEl('strong', {}, title)];
  if (text) children.push(createEl('p', {}, text));
  if (action) {
    children.push(createEl('a', { class: 'btn btn--sm', href: action.href, 'data-link': '' }, action.label));
  }
  return createEl(as, { class: `empty-state ${className}`.trim() }, children);
}
