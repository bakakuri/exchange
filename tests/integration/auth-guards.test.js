// tests/integration/auth-guards.test.js
// Integration: protected routes return 401 UNAUTHORIZED without a token;
// admin routes also return 401 (requireAdmin reads DB, falls after requireAuth).
// No Supabase credentials needed — the "no token" branch is a synchronous guard.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, get, post, patch } = require('./server.helper');

let baseUrl;
let close;

before(async () => {
  ({ baseUrl, close } = await startServer());
});

after(async () => {
  await close();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function expectUnauthorized(method, path, body = null) {
  const url = `${baseUrl}${path}`;
  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

// ── Auth-protected routes → 401 ───────────────────────────────────────────────

test('auth-guard — GET /api/auth/session requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/auth/session');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — POST /api/auth/logout requires auth', async () => {
  const { status, body } = await expectUnauthorized('POST', '/api/auth/logout');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/profile/me requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/profile/me');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/credits/balance requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/credits/balance');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/tasks requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/tasks');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/campaigns/mine requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/campaigns/mine');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/notifications requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/notifications');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/achievements requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/achievements');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/referrals requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/referrals');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/reports/mine requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/reports/mine');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

// ── Admin routes → 401 ───────────────────────────────────────────────────────

test('auth-guard — GET /api/admin/stats requires auth (401 not 403)', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/admin/stats');
  // requireAuth runs first; without a token the user never reaches requireAdmin
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/admin/users requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/admin/users');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

test('auth-guard — GET /api/admin/reports requires auth', async () => {
  const { status, body } = await expectUnauthorized('GET', '/api/admin/reports');
  assert.equal(status, 401);
  assert.equal(body.error.code, 'UNAUTHORIZED');
});

// ── Error response structure ──────────────────────────────────────────────────

test('auth-guard — 401 response has structured error body', async () => {
  const { body } = await expectUnauthorized('GET', '/api/auth/session');
  assert.ok(body.error, 'should have error field');
  assert.ok(body.error.code, 'error should have code');
  assert.ok(body.error.message, 'error should have message');
  assert.ok(body.requestId, 'should have requestId');
});
