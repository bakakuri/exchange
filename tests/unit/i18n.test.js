// tests/unit/i18n.test.js
// Every English string the site can show has a Georgian and a Russian
// translation with the same {placeholders}; Russian plurals carry all
// forms; no translation is left over for text that no longer exists.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { check, loadPart, LANGS, PARTS } = require('../../scripts/i18n-check');

test('dictionaries cover every string, with matching placeholders', () => {
  const { keys, problems } = check();
  assert.ok(keys.size > 400, `expected the full string list, got ${keys.size}`);
  assert.deepEqual(problems, []);
});

test('every dictionary part loads as a plain object of strings or plural forms', () => {
  for (const lang of LANGS) {
    for (const part of PARTS) {
      const dict = loadPart(lang, part);
      assert.equal(typeof dict, 'object', `${lang}/${part}`);
      for (const [key, value] of Object.entries(dict)) {
        const ok = typeof value === 'string' || (value && typeof value.other === 'string');
        assert.ok(ok, `${lang}/${part}: "${key}"`);
      }
    }
  }
});

test('Georgian text is in Georgian script, Russian in Cyrillic', () => {
  const georgian = /[ა-ჿ]/;
  const cyrillic = /[Ѐ-ӿ]/;
  for (const part of PARTS) {
    for (const [key, value] of Object.entries(loadPart('ka', part))) {
      if (/[a-z]{3}/i.test(key.replace(/\{\w+\}|Exchange|XP|Instagram|TikTok|YouTube|UUID|ID|https?:\/\/\S*|\/\S+|@\S+|Lela's Kitchen/g, ''))) {
        assert.match(String(value), georgian, `ka: "${key}"`);
      }
    }
    for (const [key, value] of Object.entries(loadPart('ru', part))) {
      const v = typeof value === 'string' ? value : value.other;
      if (/[a-z]{3}/i.test(key.replace(/\{\w+\}|Exchange|XP|Instagram|TikTok|YouTube|UUID|ID|https?:\/\/\S*|\/\S+|@\S+|Lela's Kitchen/g, ''))) {
        assert.match(v, cyrillic, `ru: "${key}"`);
      }
    }
  }
});
