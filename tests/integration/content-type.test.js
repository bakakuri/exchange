// tests/integration/content-type.test.js
// Integration: requireJson middleware rejects mutation requests that carry
// a body but send the wrong Content-Type.
//
// /api/auth/register is used as a convenient POST endpoint that doesn't
// need an auth token and has no prior guards that would fire first.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./server.helper');

let baseUrl;
let close;

before(async () => {
  ({ baseUrl, close } = await startServer());
});

after(async () => {
  await close();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function postRaw(path, body, contentType) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: contentType ? { 'Content-Type': contentType } : {},
    body,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

// ── Wrong Content-Type → 415 ──────────────────────────────────────────────────

test('content-type — POST with application/x-www-form-urlencoded returns 400', async () => {
  const { status, body } = await postRaw(
    '/api/auth/register',
    'email=user%40test.com&password=pass',
    'application/x-www-form-urlencoded'
  );
  assert.equal(status, 415);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('content-type — POST with text/plain returns 415', async () => {
  const { status, body } = await postRaw(
    '/api/auth/register',
    '{"email":"a@b.com"}',
    'text/plain'
  );
  assert.equal(status, 415);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('content-type — POST with multipart/form-data returns 415', async () => {
  const { status, body } = await postRaw(
    '/api/auth/register',
    '--boundary\r\nContent-Disposition: form-data; name="email"\r\n\r\na@b.com\r\n--boundary--',
    'multipart/form-data; boundary=boundary'
  );
  assert.equal(status, 415);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('content-type — POST with no Content-Type but body returns 415', async () => {
  // No Content-Type header, but body present via Transfer-Encoding: chunked
  // Fetch will set Content-Type automatically for string bodies — use a
  // Blob with no type to suppress the default.
  const blob = new Blob(['{"email":"a@b.com"}']); // type defaults to ""
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: blob,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  assert.equal(res.status, 415);
  assert.equal(json?.error?.code, 'VALIDATION_ERROR');
});

// ── Correct Content-Type → proceeds past requireJson ─────────────────────────

test('content-type — POST with application/json passes the requireJson gate', async () => {
  // Body is invalid (missing password) → 400 from the validator, not 415 from
  // requireJson. This proves the JSON gate was passed.
  const { status, body } = await postRaw(
    '/api/auth/register',
    '{"email":"user@example.com"}',
    'application/json'
  );
  // 400 = validator ran (requireJson was happy)
  assert.equal(status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  // The error is about password, not Content-Type
  assert.ok(
    body.error.message.toLowerCase().includes('password') ||
    body.error.message.toLowerCase().includes('8 char'),
    `Expected password-related error, got: ${body.error.message}`
  );
});

test('content-type — POST with application/json; charset=utf-8 passes', async () => {
  const { status } = await postRaw(
    '/api/auth/register',
    '{"email":"user@example.com","password":"validpass123"}',
    'application/json; charset=utf-8'
  );
  // 400 or 500 = got past content-type gate (validator or Supabase error)
  // The important thing is it is NOT 415
  assert.notEqual(status, 415);
});

// ── GET/DELETE are exempt ─────────────────────────────────────────────────────

test('content-type — GET without Content-Type is unaffected by requireJson', async () => {
  const { status } = await fetch(`${baseUrl}/api/health`).then((r) => ({ status: r.status }));
  assert.equal(status, 200);
});
