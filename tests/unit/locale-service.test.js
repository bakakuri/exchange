// tests/unit/locale-service.test.js
// Country → starting language, and the controller's no-store response.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detect, normalizeCountry, languageForCountry } = require('../../server/services/locale.service');
const controller = require('../../server/controllers/locale.controller');
const SUPPORTED = require('../../server/constants/languages');

test('Georgia opens in Georgian', () => {
  assert.deepEqual(detect({ 'x-vercel-ip-country': 'GE' }), { country: 'GE', language: 'ka' });
});

test('Russia, Belarus, Kazakhstan and Kyrgyzstan open in Russian', () => {
  for (const c of ['RU', 'BY', 'KZ', 'KG']) {
    assert.equal(detect({ 'x-vercel-ip-country': c }).language, 'ru', c);
  }
});

test('other countries leave the choice to the browser', () => {
  for (const c of ['DE', 'US', 'UA', 'AM', 'AZ', 'TR']) {
    assert.deepEqual(detect({ 'x-vercel-ip-country': c }), { country: c, language: null }, c);
  }
});

test('missing, malformed and placeholder countries give nulls', () => {
  assert.deepEqual(detect({}), { country: null, language: null });
  assert.deepEqual(detect(), { country: null, language: null });
  for (const v of ['', 'G', 'GEO', '12', 'XX', 'T1', '<script>']) {
    assert.equal(normalizeCountry(v), null, v);
  }
});

test('header is case- and whitespace-insensitive; Cloudflare header works too', () => {
  assert.equal(detect({ 'x-vercel-ip-country': ' ge ' }).language, 'ka');
  assert.equal(detect({ 'cf-ipcountry': 'RU' }).language, 'ru');
  assert.equal(languageForCountry(null), null);
});

test('every mapped language is a supported one', () => {
  const { LANGUAGE_BY_COUNTRY } = require('../../server/services/locale.service');
  for (const lang of Object.values(LANGUAGE_BY_COUNTRY)) assert.ok(SUPPORTED.includes(lang), lang);
});

test('controller answers JSON that no shared cache may keep', () => {
  const headers = {};
  let body;
  const res = { set: (k, v) => { headers[k] = v; return res; }, json: (b) => { body = b; return res; } };
  controller.detect({ headers: { 'x-vercel-ip-country': 'KZ' } }, res);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(body, { country: 'KZ', language: 'ru' });
});
