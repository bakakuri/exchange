// js/core/i18n.js
// Translation engine. English is the source language and the key: code
// writes t('Find tasks') and the active dictionary (js/i18n/<lang>.js)
// maps that English text to the translation. A missing entry falls back
// to the English text, so nothing ever renders blank.
//
//   t('Level {level}', { level: 3 })        → "დონე 3"
//   tn(5, '{n} credit', '{n} credits')       → "5 кредитов" (plural rules)
//   translateDom(el)                         → static page HTML
//
// Which language is active, and switching it, lives in core/language.js.

export const LANGUAGES = Object.freeze([
  { code: 'ka', name: 'ქართული', short: 'KA', locale: 'ka-GE' },
  { code: 'ru', name: 'Русский', short: 'RU', locale: 'ru-RU' },
  { code: 'en', name: 'English', short: 'EN', locale: 'en-US' },
]);

export const SOURCE_LANGUAGE = 'en';

let active = SOURCE_LANGUAGE;
let dict = {};
let rules = new Intl.PluralRules(SOURCE_LANGUAGE);

export const currentLanguage = () => active;
export const languageInfo = (code = active) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[2];
export const currentLocale = () => languageInfo().locale;

export function setDictionary(code, entries) {
  active = code;
  dict = entries || {};
  rules = new Intl.PluralRules(languageInfo(code).locale);
}

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] ?? whole));
}

/** Translate English source text. Unknown text comes back unchanged. */
export function t(text, vars) {
  const entry = dict[text];
  const out = typeof entry === 'string' ? entry : entry?.other ?? text;
  return interpolate(out, vars);
}

/** True if the active dictionary has this exact English text. */
export const hasTranslation = (text) => typeof dict[text] === 'string';

/**
 * Plural-aware t(). Pass both English forms; the dictionary entry is
 * keyed by the plural ("other") form and is either one string (Georgian
 * uses the singular after numbers) or { one, few, many, other }.
 */
export function tn(n, one, other, vars) {
  const entry = dict[other];
  let out;
  if (entry == null) out = rules.select(n) === 'one' ? one : other;
  else if (typeof entry === 'string') out = entry;
  else out = entry[rules.select(n)] ?? entry.other ?? other;
  return interpolate(out, { n: formatNumber(n), ...vars });
}

// Chrome has no Georgian number data; Russian groups digits the same way
// Georgian does (1 000, non-breaking space), so it stands in.
const numberLocale = () => {
  const locale = currentLocale();
  return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : active === 'ka' ? 'ru-RU' : locale;
};
export const formatNumber = (n) => new Intl.NumberFormat(numberLocale()).format(n);

// ── Static HTML ─────────────────────────────────────────────────────────
// Page fragments (pages/*.html) and the shell (index.html) are written in
// English. translateDom() swaps each text node and translatable attribute
// for its translation, remembering the English original so a later
// language switch can translate again from the source. Subtrees marked
// data-i18n-skip (rendered by JS, e.g. #app-root inside the shell, or
// user content) are left alone.

const ATTRIBUTES = ['placeholder', 'aria-label', 'title', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'svg', 'CODE', 'PRE']);
const sourceText = new WeakMap();
const sourceAttrs = new WeakMap();

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function translateText(node) {
  if (!sourceText.has(node)) sourceText.set(node, node.nodeValue);
  const source = sourceText.get(node);
  const key = collapse(source);
  if (!key) return;
  // A plural entry in static HTML has no number yet: show the general
  // ("many") form until a script fills in the real count.
  const entry = typeof dict[key] === 'string' ? dict[key] : dict[key]?.many ?? dict[key]?.other;
  if (typeof entry !== 'string') {
    if (node.nodeValue !== source) node.nodeValue = source;
    return;
  }
  const lead = /^\s/.test(source) ? ' ' : '';
  const trail = /\s$/.test(source) ? ' ' : '';
  node.nodeValue = lead + entry + trail;
}

function translateAttributes(el) {
  let saved = sourceAttrs.get(el);
  for (const name of ATTRIBUTES) {
    if (!el.hasAttribute(name) && !saved?.[name]) continue;
    if (!saved) { saved = {}; sourceAttrs.set(el, saved); }
    if (!(name in saved)) saved[name] = el.getAttribute(name);
    const entry = dict[collapse(saved[name] || '')];
    el.setAttribute(name, typeof entry === 'string' ? entry : saved[name]);
  }
}

export function translateDom(root) {
  if (!root) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (SKIP_TAGS.has(node.tagName) || node.hasAttribute('data-i18n-skip')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else translateAttributes(node);
  }
}
