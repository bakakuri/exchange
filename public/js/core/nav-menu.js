// js/core/nav-menu.js
// Small-screen header menu. Below the breakpoint in css/layout.css the main
// nav is collapsed behind #menu-toggle; this module opens/closes it and
// keeps aria-expanded honest. The panel closes when the interaction is
// over: a link or button inside the header is used, Escape is pressed,
// the user taps outside the header, history navigation happens, or the
// viewport grows back to desktop width.

const OPEN_CLASS = 'is-menu-open';
// Keep in sync with the max-width breakpoint in css/layout.css.
const DESKTOP_QUERY = '(min-width: 1241px)';

export function initNavMenu() {
  const header = document.querySelector('.app-header');
  const toggle = document.getElementById('menu-toggle');
  if (!header || !toggle) return;

  const isOpen = () => header.classList.contains(OPEN_CLASS);
  const setOpen = (open) => {
    header.classList.toggle(OPEN_CLASS, open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };

  toggle.addEventListener('click', () => setOpen(!isOpen()));

  // Route links, the brand link and "Sign out" all finish the interaction.
  // The router's own body-level click handler still performs navigation.
  header.addEventListener('click', (e) => {
    const target = e.target.closest('a, button');
    if (target && target !== toggle && isOpen()) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (isOpen() && !header.contains(e.target)) setOpen(false);
  });

  window.addEventListener('popstate', () => setOpen(false));

  window.matchMedia(DESKTOP_QUERY).addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}
