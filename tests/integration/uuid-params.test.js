// tests/integration/uuid-params.test.js
// Integration: validateUuidParam middleware returns 400 VALIDATION_ERROR for
// bad UUID path params.
//
// NOTE: In the production Express app, requireAuth runs BEFORE validateUuidParam
// on every route (so a missing token returns 401 regardless of the UUID). The
// test fixture in server.helper.js deliberately inverts this order for /:id
// routes so that UUID validation is directly observable at the HTTP level.
// This lets us confirm the middleware is wired in and rejects bad values even
// when there is no database available.
//
// Assertions:
//   bad UUID  + no token  → 400  (UUID gate fires first in fixture)
//   good UUID + no token  → 401  (UUID passes, auth gate fires)

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

const VALID_UUID = '11111111-2222-3333-4444-555555555555';
const BAD_UUID   = 'not-a-uuid';

// ── Bad UUID → 400 before auth ────────────────────────────────────────────────

test('uuid-guard — /api/campaigns/:bad-uuid → 400 VALIDATION_ERROR', async () => {
  const { status, body } = await get(baseUrl, `/api/campaigns/${BAD_UUID}`);
  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.ok(body.error.message.includes('id'), `expected "id" in message: ${body.error.message}`);
});

test('uuid-guard — /api/admin/users/:bad-uuid → 400 VALIDATION_ERROR', async () => {
  const { status, body } = await get(baseUrl, `/api/admin/users/${BAD_UUID}`);
  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('uuid-guard — PATCH /api/social/:bad-uuid → 400 VALIDATION_ERROR', async () => {
  const res = await fetch(`${baseUrl}/api/social/${BAD_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('uuid-guard — error message includes the param name', async () => {
  const { body } = await get(baseUrl, `/api/campaigns/${BAD_UUID}`);
  assert.ok(body.error.message.toLowerCase().includes('id'),
    `Expected param name "id" in error, got: ${body.error.message}`);
});

// ── SQL injection in path param is rejected as invalid UUID ───────────────────

test('uuid-guard — SQL injection path param returns 400', async () => {
  const injection = encodeURIComponent("'; DROP TABLE users; --");
  const { status, body } = await get(baseUrl, `/api/campaigns/${injection}`);
  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('uuid-guard — numeric id returns 400', async () => {
  const { status, body } = await get(baseUrl, '/api/campaigns/12345');
  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

// ── Valid UUID passes UUID gate, then hits auth gate ─────────────────────────

test('uuid-guard — valid UUID passes UUID check then returns 401 (no token)', async () => {
  const { status, body } = await get(baseUrl, `/api/campaigns/${VALID_UUID}`);
  // UUID gate passed → auth gate fires → no token → 401
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('uuid-guard — valid UUID in admin route passes UUID check then returns 401', async () => {
  const { status, body } = await get(baseUrl, `/api/admin/users/${VALID_UUID}`);
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('uuid-guard — uppercase UUID also passes UUID check', async () => {
  const { status } = await get(baseUrl, `/api/campaigns/${VALID_UUID.toUpperCase()}`);
  // UUID gate should pass, then auth gate returns 401
  assert.equal(status, 401);
});

// ── Routes are registered (not 404) ──────────────────────────────────────────

test('uuid-guard — notifications PATCH /:id/read route is registered', async () => {
  const res = await fetch(`${baseUrl}/api/notifications/${VALID_UUID}/read`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  // Route is registered → gets to auth gate → 401
  assert.equal(res.status, 401);
});

test('uuid-guard — notifications PATCH /:bad-uuid/read rejects UUID', async () => {
  const res = await fetch(`${baseUrl}/api/notifications/${BAD_UUID}/read`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});
