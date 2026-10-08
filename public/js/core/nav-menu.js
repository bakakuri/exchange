// js/core/nav-menu.js
// Navigation chrome behaviour.
//  - Current page: every nav link (sidebar + tab bar) matching the URL gets
//    aria-current="page"; the longest match wins, so /submissions/review
//    marks "To review", not "Submissions", and "/" only matches exactly.
//  - Drawer (small screens): the tab bar's Menu button opens the sidebar
//    as a drawer. It closes on any link/button inside it, Escape, a tap on
//    the scrim, history navigation, or growing back to desktop width.

const OPEN_CLASS = 'is-menu-open';
// Keep in sync with the sidebar breakpoint in css/layout.css.
const DESKTOP_QUERY = '(min-width: 1024px)';

function markCurrentLinks() {
  const path = location.pathname;
  for (const group of document.querySelectorAll('.app-nav, .tabbar')) {
    let best = null;
    for (const link of group.querySelectorAll('a[data-link]')) {
      const href = link.getAttribute('href');
      const matches = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
      link.removeAttribute('aria-current');
      if (matches && (!best || href.length > best.getAttribute('href').length)) best = link;
    }
    best?.setAttribute('aria-current', 'page');
  }
}

export function initNavMenu() {
  const body = document.body;
  const drawer = document.getElementById('main-menu');
  const scrim = document.querySelector('[data-menu-scrim]');
  const toggles = [...document.querySelectorAll('[data-menu-toggle]')];

  // Re-mark whenever the router swaps the page content.
  const root = document.getElementById('app-root');
  if (root) new MutationObserver(markCurrentLinks).observe(root, { childList: true });
  markCurrentLinks();

  if (!drawer || !toggles.length) return;

  const isOpen = () => body.classList.contains(OPEN_CLASS);
  const setOpen = (open) => {
    body.classList.toggle(OPEN_CLASS, open);
    if (scrim) scrim.hidden = !open;
    toggles.forEach((t) => t.setAttribute('aria-expanded', String(open)));
    if (open) drawer.querySelector('a, button')?.focus({ preventScroll: true });
  };

  toggles.forEach((t) => t.addEventListener('click', () => setOpen(!isOpen())));
  scrim?.addEventListener('click', () => setOpen(false));

  // Links, Sign out and picking a language finish the interaction; the
  // theme switch and opening the language list don't.
  drawer.addEventListener('click', (e) => {
    const target = e.target.closest('a, button');
    if (target && !target.matches('[data-theme-toggle], .lang-menu__button') && isOpen()) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      toggles[0].focus();
    }
  });

  window.addEventListener('popstate', () => setOpen(false));
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}
