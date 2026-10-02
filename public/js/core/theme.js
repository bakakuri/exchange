// js/core/theme.js
// Light/dark theme. By default the site follows the device setting (and
// keeps following it if that changes). The header button (#theme-toggle)
// switches theme; the choice is remembered only while it differs from the
// device - switching back to the device's own theme forgets the override,
// so "follow my phone" is always one tap away.
// js/core/theme-init.js applies the initial theme before first paint.

const STORAGE_KEY = 'exchange.theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const deviceTheme = () => (darkQuery.matches ? 'dark' : 'light');

function storedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function remember(theme) {
  try {
    if (theme === deviceTheme()) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // storage unavailable - the switch still works for this visit
  }
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
  const toggle = document.getElementById('theme-toggle');
  toggle?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
}

export function initTheme() {
  apply(storedTheme() || deviceTheme());

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    remember(next);
    apply(next);
  });

  darkQuery.addEventListener('change', () => {
    if (!storedTheme()) apply(deviceTheme());
  });
}
