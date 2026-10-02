// js/core/nav-menu.js
// Small-screen header menu. Below the breakpoint in css/layout.css the main
// menu (#main-menu: page links + account links) is collapsed behind #menu-toggle; this module opens/closes it and
// keeps aria-expanded honest. The panel closes when the interaction is
// over: a link or button inside the header is used, Escape is pressed,
// the user taps outside the header, history navigation happens, or the
// viewport grows back to desktop width.

const OPEN_CLASS = 'is-menu-open';
// Keep in sync with the max-width breakpoint in css/layout.css.
const DESKTOP_QUERY = '(min-width: 821px)';

// Marks the nav link for the current page with aria-current="page" (styled
// in layout.css). The longest matching link wins, so /submissions/review
// highlights "To review", not "Submissions"; "/" only matches exactly.
function markCurrentLink(nav) {
  const path = location.pathname;
  let best = null;
  for (const link of nav.querySelectorAll('a[data-link]')) {
    const href = link.getAttribute('href');
    const matches = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
    link.removeAttribute('aria-current');
    if (matches && (!best || href.length > best.getAttribute('href').length)) best = link;
  }
  best?.setAttribute('aria-current', 'page');
}

export function initNavMenu() {
  const header = document.querySelector('.app-header');
  const toggle = document.getElementById('menu-toggle');
  // Page links and account links both live in #main-menu.
  const nav = document.getElementById('main-menu');
  if (!header || !toggle) return;

  // Re-mark whenever the page content or the account links change (the
  // router swaps #app-root; auth-nav.js re-renders #auth-nav).
  if (nav) {
    const remark = () => markCurrentLink(nav);
    const observer = new MutationObserver(remark);
    const root = document.getElementById('app-root');
    if (root) observer.observe(root, { childList: true });
    const authSlot = document.getElementById('auth-nav');
    if (authSlot) observer.observe(authSlot, { childList: true });
    remark();
  }

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
    // The theme switch is a setting, not navigation - keep the menu open.
    if (target && target !== toggle && target.id !== 'theme-toggle' && isOpen()) setOpen(false);
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
