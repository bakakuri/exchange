// tests/integration/request-id.test.js
// Integration: every response carries an X-Request-Id header;
// error response bodies include a matching requestId field.

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, get, post } = require('./server.helper');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let baseUrl;
let close;

before(async () => {
  ({ baseUrl, close } = await startServer());
});

after(async () => {
  await close();
});

test('request-id — 200 response includes X-Request-Id header', async () => {
  const { headers } = await get(baseUrl, '/api/health');
  const id = headers.get('x-request-id');
  assert.ok(id, 'X-Request-Id header should be present');
  assert.match(id, UUID_RE);
});

test('request-id — 404 response includes X-Request-Id header', async () => {
  const { headers } = await get(baseUrl, '/api/not-found-endpoint');
  const id = headers.get('x-request-id');
  assert.ok(id, 'X-Request-Id header should be present on error responses');
  assert.match(id, UUID_RE);
});

test('request-id — error body includes requestId matching header', async () => {
  const { headers, body } = await get(baseUrl, '/api/not-found-endpoint');
  const headerId = headers.get('x-request-id');
  assert.ok(headerId);
  assert.equal(body.requestId, headerId,
    'error response body.requestId should match X-Request-Id header');
});

test('request-id — each request gets a unique ID', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const { headers } = await get(baseUrl, '/api/health');
    ids.push(headers.get('x-request-id'));
  }
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'Each request should have a unique X-Request-Id');
});

test('request-id — honours upstream X-Request-Id header', async () => {
  const upstreamId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const res = await fetch(`${baseUrl}/api/health`, {
    headers: { 'x-request-id': upstreamId },
  });
  const returnedId = res.headers.get('x-request-id');
  assert.equal(returnedId, upstreamId,
    'Server should echo back the upstream X-Request-Id');
});

test('request-id — 401 response body includes requestId', async () => {
  const { headers, body } = await get(baseUrl, '/api/auth/session');
  const headerId = headers.get('x-request-id');
  assert.ok(headerId);
  assert.equal(body.requestId, headerId);
});
