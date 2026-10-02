// js/shared/dom.js
// Escapes text for the few places that still build markup with template
// strings + innerHTML. Anything a user wrote (descriptions, display names,
// usernames) must pass through this; prefer createEl() for new code.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const qs = (sel, ctx = document) => ctx.querySelector(sel);
export const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

export function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}
