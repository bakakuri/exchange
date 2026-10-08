// js/core/language.js
// Which language the site shows, and switching it.
//
// Starting language, first match wins:
//   1. one the person picked on this device (language menu, profile);
//   2. their account's language (profiles.language), once signed in;
//   3. their country - GET /api/locale reads the CDN's geo header
//      (Georgia → ქართული; Russia, Belarus, Kazakhstan, Kyrgyzstan →
//      Русский), cached for a few days;
//   4. the phone/browser language, if it is one of ours;
//   5. English.
// theme-init.js makes the same guess from storage before first paint and
// hides the page (briefly, with a CSS fallback) until this has run.

import { LANGUAGES, SOURCE_LANGUAGE, setDictionary, translateDom, currentLanguage, t } from './i18n.js';
import { eventBus } from './events.js';
import { store } from './state.js';
import { CONFIG } from './config.js';
import { api } from '../shared/api.js';
import { updateCachedUser } from '../auth/auth.js';

const CHOICE_KEY = 'exchange.lang';
const GEO_KEY = 'exchange.lang.geo';
const GEO_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const GEO_TIMEOUT_MS = 1500;

const isSupported = (code) => LANGUAGES.some((l) => l.code === code);

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
function forget(key) {
  try { localStorage.removeItem(key); } catch { /* storage blocked */ }
}

const savedChoice = () => (isSupported(read(CHOICE_KEY)) ? read(CHOICE_KEY) : null);
const accountLanguage = () => {
  const lang = store.getState().user?.language;
  return isSupported(lang) ? lang : null;
};

function browserLanguage() {
  for (const tag of navigator.languages || [navigator.language]) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }
  return null;
}

async function countryLanguage() {
  try {
    const cached = JSON.parse(read(GEO_KEY) || 'null');
    if (cached && Date.now() - cached.at < GEO_MAX_AGE_MS) return isSupported(cached.language) ? cached.language : null;
  } catch { /* corrupt cache - ask again */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
  try {
    const res = await fetch(`${CONFIG.API_BASE}/locale`, { signal: controller.signal });
    if (!res.ok) return null;
    const { language } = await res.json();
    const lang = isSupported(language) ? language : null;
    write(GEO_KEY, JSON.stringify({ language: lang, at: Date.now() }));
    return lang;
  } catch {
    return null; // offline, slow or blocked - the browser language decides
  } finally {
    clearTimeout(timer);
  }
}

// Each language is split by where the text appears (scripts/i18n-check.js
// keeps the parts complete and free of duplicates).
const PARTS = ['shell', 'pages', 'features', 'server'];

async function loadDictionary(code) {
  if (code === SOURCE_LANGUAGE) return {};
  const parts = await Promise.all(PARTS.map((part) => import(`../i18n/${code}/${part}.js`)));
  return Object.assign({}, ...parts.map((m) => m.default));
}

let ticket = 0;

async function apply(code) {
  const mine = ++ticket;
  let entries = {};
  try {
    entries = await loadDictionary(code);
  } catch {
    code = SOURCE_LANGUAGE; // dictionary failed to load - English beats a broken page
  }
  if (mine !== ticket) return; // a newer switch started meanwhile

  setDictionary(code, entries);
  const root = document.documentElement;
  root.lang = code;
  translateDom(document.body); // the shell; the router translates each page
  const meta = document.querySelector('meta[name="description"]');
  if (meta) {
    meta.dataset.source ??= meta.content;
    meta.content = t(meta.dataset.source);
  }
  root.setAttribute('data-i18n', 'ready');
  eventBus.emit('language:change', code);
}

/**
 * Switch language. remember: keep it as this device's choice (the
 * language menu does; automatic changes don't). syncAccount: also save
 * it to the signed-in account so other devices follow.
 */
export async function setLanguage(code, { remember = false, syncAccount = false } = {}) {
  if (!isSupported(code)) return;
  if (remember) write(CHOICE_KEY, code);
  if (syncAccount) saveToAccount(code);
  if (code !== currentLanguage() || document.documentElement.dataset.i18n !== 'ready') await apply(code);
}

function saveToAccount(code) {
  const user = store.getState().user;
  if (!user || user.language === code) return;
  updateCachedUser({ language: code });
  api.profile.update({ language: code }).catch(() => { /* the local choice still holds */ });
}

/** Forget this device's choice and the account's; go back to the guess. */
export async function useAutomaticLanguage() {
  forget(CHOICE_KEY);
  const code = (await countryLanguage()) || browserLanguage() || SOURCE_LANGUAGE;
  if (code !== currentLanguage()) await apply(code);
}

// Signing in (or the server confirming a stored session) can bring the
// account's language; it applies unless this device has its own choice.
let lastAccountLanguage;
function onStateChange() {
  const lang = accountLanguage();
  if (lang === lastAccountLanguage) return undefined;
  lastAccountLanguage = lang;
  if (lang && !savedChoice() && lang !== currentLanguage()) return setLanguage(lang);
  return undefined;
}

export async function initLanguage() {
  lastAccountLanguage = accountLanguage();
  const code = savedChoice() || lastAccountLanguage || (await countryLanguage()) || browserLanguage() || SOURCE_LANGUAGE;
  await apply(code);
  eventBus.on('state:change', onStateChange);
  // The server may have confirmed the session (and its language) while
  // the country lookup was in flight.
  await onStateChange();
}
