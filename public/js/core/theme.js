// js/core/theme.js
// Light/dark theme. By default the site follows the device setting (and
// keeps following it if that changes). Any [data-theme-toggle] button
// switches theme; the choice is remembered only while it differs from the
// device - switching back to the device's own theme forgets the override,
// so "follow my phone" is always one tap away.
// js/core/theme-init.js applies the initial theme before first paint.

import { t } from './i18n.js';
import { eventBus } from './events.js';

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
    ?.setAttribute('content', theme === 'dark' ? '#0d0920' : '#f5f3ff');
  labelToggles();
}

// The new theme opens as a circle growing from the switch that was
// pressed (View Transitions; layout.css draws it). Elsewhere, or with
// reduced motion, it simply switches.
function switchTo(theme, toggle) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || reduced) {
    apply(theme);
    return;
  }
  const box = toggle.getBoundingClientRect();
  const root = document.documentElement;
  root.style.setProperty('--reveal-x', `${box.left + box.width / 2}px`);
  root.style.setProperty('--reveal-y', `${box.top + box.height / 2}px`);
  document.startViewTransition(() => apply(theme));
}

// Toggles carry data-i18n-skip in index.html: their label depends on the
// theme, so it is set here (and again when the language changes).
function labelToggles() {
  const label = currentTheme() === 'dark' ? t('Switch to light theme') : t('Switch to dark theme');
  document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => toggle.setAttribute('aria-label', label));
}

export function initTheme() {
  apply(storedTheme() || deviceTheme());

  // Every [data-theme-toggle] (top bar, sidebar user row) switches theme.
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-theme-toggle]');
    if (!toggle) return;
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    remember(next);
    switchTo(next, toggle);
  });

  eventBus.on('language:change', labelToggles);

  darkQuery.addEventListener('change', () => {
    if (!storedTheme()) apply(deviceTheme());
  });
}
