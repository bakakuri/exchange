#!/usr/bin/env node
// scripts/i18n-check.js
// Lists every English string the site can show and checks that each
// translation (public/js/i18n/<lang>/*.js) covers it, with the same
// {placeholders}. Sources:
//   - static HTML: public/index.html and public/pages/*.html (text and
//     placeholder / aria-label / title / alt attributes);
//   - JS: t('…'), tn(n, '…', '…') and errorMessage(err, '…') literals,
//     route titles;
//   - server: AppError messages, validator messages, sign-up warnings;
//   - database: raise-exception messages, notification titles/bodies,
//     ledger descriptions and the achievement catalog.
// Run: node scripts/i18n-check.js   (exit code 1 when something is off)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const LANGS = ['ka', 'ru'];
const PARTS = ['shell', 'pages', 'features', 'server'];

// Shown as-is in every language: brand, platform names, sample handles.
const KEEP_AS_IS = new Set([
  'Exchange', '© 2026 Exchange', 'Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'Telegram',
  'Discord', 'Twitch', 'Reddit', 'Pinterest', 'LinkedIn', 'tamuna.ceramics', '@tamuna.clay',
  'youtube.com/@lelaskitchen', 'https://', 'https://…', 'XXXXXXXX', 'ქართული', 'Русский', 'English',
]);

const read = (file) => fs.readFileSync(file, 'utf8');
const walk = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const full = path.join(dir, d.name);
  if (d.isDirectory()) return walk(full, ext);
  return d.name.endsWith(ext) ? [full] : [];
});

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', ndash: '–', mdash: '—', minus: '−', copy: '©', rarr: '→', larr: '←', hellip: '…', middot: '·' };
const decode = (s) => s.replace(/&(#?\w+);/g, (m, name) => ENTITIES[name] ?? m);
const collapse = (s) => decode(s).replace(/\s+/g, ' ').trim();
const unescapeJs = (s) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
const hasWords = (s) => /\p{L}/u.test(s);

function add(keys, key, source) {
  if (!key || !hasWords(key) || KEEP_AS_IS.has(key)) return;
  if (!keys.has(key)) keys.set(key, new Set());
  keys.get(key).add(source);
}

// ── static HTML ──────────────────────────────────────────────────────────

function htmlKeys(keys, file) {
  let src = read(file)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|code|pre)\b[\s\S]*?<\/\1>/gi, ' ')
    // data-i18n-skip subtrees in the shell (language menus) hold no source text
    .replace(/<div class="lang-menu[^"]*"[^>]*data-i18n-skip[^>]*>[\s\S]*?<\/div>/g, ' ');
  const rel = path.relative(ROOT, file);
  for (const tag of src.match(/<[a-z][^>]*>/gi) || []) {
    if (/data-i18n-skip/.test(tag)) continue;
    for (const m of tag.matchAll(/\s(placeholder|aria-label|title|alt)="([^"]*)"/g)) add(keys, collapse(m[2]), rel);
  }
  src = src.replace(/<[^>]+>/g, '\u0000');
  for (const chunk of src.split('\u0000')) add(keys, collapse(chunk), rel);
}

// ── JS ───────────────────────────────────────────────────────────────────

const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`;
const T_RE = new RegExp(String.raw`\bt\(\s*(?:${STR})`, 'g');
const TN_RE = new RegExp(String.raw`\btn\(\s*[^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g');
const ERR_RE = new RegExp(String.raw`\berrorMessage\(\s*[\w.]+\s*,\s*(?:${STR})`, 'g');
const TITLE_RE = new RegExp(String.raw`\btitle:\s*(?:${STR})`, 'g');

function jsKeys(keys, plurals, file) {
  const src = read(file).replace(/^\s*\/\/.*$/gm, '');
  const rel = path.relative(ROOT, file);
  for (const m of src.matchAll(T_RE)) add(keys, unescapeJs(m[1] ?? m[2]), rel);
  for (const m of src.matchAll(ERR_RE)) add(keys, unescapeJs(m[1] ?? m[2]), rel);
  for (const m of src.matchAll(TN_RE)) {
    const other = unescapeJs(m[3] ?? m[4]);
    add(keys, other, rel);
    plurals.add(other);
  }
  if (file.endsWith('routes.js')) for (const m of src.matchAll(TITLE_RE)) add(keys, unescapeJs(m[1] ?? m[2]), rel);
}

// ── server + database ────────────────────────────────────────────────────

function serverKeys(keys) {
  for (const file of walk(path.join(ROOT, 'server'), '.js')) {
    const src = read(file);
    const rel = path.relative(ROOT, file);
    for (const m of src.matchAll(/new AppError\(\s*ErrorCodes\.\w+,\s*'([^'$]+)'/g)) add(keys, m[1], rel);
    for (const m of src.matchAll(/errors\.push\(\s*'([^'$]+)'\s*\)/g)) add(keys, m[1], rel);
    if (rel.endsWith('auth.service.js')) {
      for (const m of src.matchAll(/'([A-Z][^'$]* [^'$]*\.)'/g)) add(keys, m[1], rel);
    }
  }
  const sqlDir = path.join(ROOT, 'supabase', 'migrations');
  for (const file of walk(sqlDir, '.sql')) {
    const src = read(file);
    const rel = path.relative(ROOT, file);
    for (const m of src.matchAll(/raise exception '([A-Z_]+): ([^'%]+)'/gi)) {
      if (m[1] !== 'FAIL' && !/IMMUTABLE/.test(m[1])) add(keys, m[2], rel);
    }
    for (const m of src.matchAll(/insert into public\.notifications[\s\S]*?;/g)) {
      // whole literals only - a piece of a || concatenation ends in a space
      for (const s of m[0].matchAll(/'([A-Z][^']*[^\s'])'/g)) add(keys, s[1], rel);
    }
    for (const m of src.matchAll(/write_ledger_entry\([^;]*?'[a-z_]+',\s*'([^']+)'/g)) add(keys, m[1], rel);
    if (rel.endsWith('010_achievements.sql')) {
      for (const m of src.matchAll(/\('[a-z_0-9]+', '([^']+)', '([^']+)'\)/g)) { add(keys, m[1], rel); add(keys, m[2], rel); }
    }
  }
}

function collect() {
  const keys = new Map();
  const plurals = new Set();
  htmlKeys(keys, path.join(PUBLIC, 'index.html'));
  for (const f of walk(path.join(PUBLIC, 'pages'), '.html')) htmlKeys(keys, f);
  for (const f of walk(path.join(PUBLIC, 'js'), '.js')) {
    if (f.includes(`${path.sep}i18n${path.sep}`)) continue;
    jsKeys(keys, plurals, f);
  }
  serverKeys(keys);
  return { keys, plurals };
}

// ── dictionaries ─────────────────────────────────────────────────────────

function loadPart(lang, part) {
  const file = path.join(PUBLIC, 'js', 'i18n', lang, `${part}.js`);
  if (!fs.existsSync(file)) return {};
  const body = read(file).replace(/^\s*\/\/.*$/gm, '').replace(/export default/, 'return');
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function check() {
  const { keys, plurals } = collect();
  const problems = [];
  for (const lang of LANGS) {
    const merged = {};
    for (const part of PARTS) {
      const dict = loadPart(lang, part);
      for (const [k, v] of Object.entries(dict)) {
        if (k in merged) problems.push(`${lang}: "${k}" is in more than one part`);
        merged[k] = v;
      }
    }
    for (const key of keys.keys()) {
      const v = merged[key];
      if (v === undefined) { problems.push(`${lang}: missing "${key}"  (${[...keys.get(key)][0]})`); continue; }
      const forms = typeof v === 'string' ? [v] : Object.values(v);
      if (typeof v !== 'string' && !plurals.has(key)) problems.push(`${lang}: "${key}" has plural forms but is not used with tn()`);
      if (lang === 'ru' && plurals.has(key) && (typeof v === 'string' || !v.one || !v.few || !v.many)) {
        problems.push(`ru: "${key}" needs one/few/many forms`);
      }
      for (const form of forms) {
        if (placeholders(form) !== placeholders(key)) problems.push(`${lang}: placeholders differ for "${key}" → "${form}"`);
        if (!form.trim()) problems.push(`${lang}: empty translation for "${key}"`);
      }
    }
    for (const key of Object.keys(merged)) {
      if (!keys.has(key)) problems.push(`${lang}: unused "${key}"`);
    }
  }
  return { keys, plurals, problems };
}

module.exports = { collect, check, loadPart, LANGS, PARTS };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--list') {
    const { keys, plurals } = collect();
    for (const [k, src] of keys) console.log(`${plurals.has(k) ? '[n] ' : ''}${k}\t${[...src].join(', ')}`);
    process.exit(0);
  }
  const { keys, problems } = check();
  for (const p of problems) console.log(p);
  console.log(`${keys.size} strings, ${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
}
