// tests/integration/health.test.js
// Integration: GET /api/health returns the expected shape.
// No Supabase credentials needed — this endpoint is static.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, get } = require('./server.helper');

let baseUrl;
let close;

before(async () => {
  ({ baseUrl, close } = await startServer());
});

after(async () => {
  await close();
});

test('GET /api/health — returns 200', async () => {
  const { status } = await get(baseUrl, '/api/health');
  assert.equal(status, 200);
});

test('GET /api/health — returns status ok', async () => {
  const { body } = await get(baseUrl, '/api/health');
  assert.equal(body.status, 'ok');
});

test('GET /api/health — includes stage field', async () => {
  const { body } = await get(baseUrl, '/api/health');
  assert.ok(typeof body.stage === 'string');
  assert.ok(body.stage.startsWith('stage-'));
});

test('GET /api/unknown-endpoint — API 404 returns NOT_FOUND code', async () => {
  const { status, body } = await get(baseUrl, '/api/this-does-not-exist');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});
