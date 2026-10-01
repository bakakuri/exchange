// tests/unit/middleware.test.js
// Unit tests for Express middleware functions using mock req/res/next objects.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../../server/utils/errors');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {},
    params: {},
    requestId: null,
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _headers: {},
    setHeader(name, value) { this._headers[name] = value; return this; },
    getHeader(name) { return this._headers[name]; },
  };
  return res;
}

function captureNext() {
  let captured;
  const next = (arg) => { captured = arg; };
  next.get = () => captured;
  return next;
}

// ── request-id middleware ─────────────────────────────────────────────────────

const { requestId } = require('../../server/middleware/request-id');

test('requestId — generates a UUID and sets X-Request-Id header', () => {
  const req = makeReq();
  const res = makeRes();
  const next = captureNext();

  requestId(req, res, next);

  assert.match(req.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(res.getHeader('X-Request-Id'), req.requestId);
  assert.equal(next.get(), undefined); // called without error
});

test('requestId — honours upstream X-Request-Id header', () => {
  const upstreamId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const req = makeReq({ headers: { 'x-request-id': upstreamId } });
  const res = makeRes();
  const next = captureNext();

  requestId(req, res, next);

  assert.equal(req.requestId, upstreamId);
  assert.equal(res.getHeader('X-Request-Id'), upstreamId);
});

test('requestId — different calls generate different IDs', () => {
  const ids = new Set();
  for (let i = 0; i < 10; i++) {
    const req = makeReq();
    const res = makeRes();
    const next = captureNext();
    requestId(req, res, next);
    ids.add(req.requestId);
  }
  assert.equal(ids.size, 10, 'All request IDs should be unique');
});

// ── require-json middleware ───────────────────────────────────────────────────

const { requireJson } = require('../../server/middleware/require-json');

test('requireJson — GET passes through without Content-Type check', () => {
  const req = makeReq({ method: 'GET', headers: {} });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  assert.equal(next.get(), undefined); // called, no error
});

test('requireJson — DELETE passes through', () => {
  const req = makeReq({ method: 'DELETE', headers: {} });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  assert.equal(next.get(), undefined);
});

test('requireJson — POST with no body passes through', () => {
  // No Content-Length or Transfer-Encoding → treated as bodyless
  const req = makeReq({ method: 'POST', headers: {} });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  assert.equal(next.get(), undefined);
});

test('requireJson — POST with application/json passes through', () => {
  const req = makeReq({
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': '10',
    },
  });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  assert.equal(next.get(), undefined);
});

test('requireJson — POST with form-encoded body returns VALIDATION_ERROR', () => {
  const req = makeReq({
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': '12',
    },
  });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  const err = next.get();
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.equal(err.status, 415);
});

test('requireJson — PATCH with text/plain body returns VALIDATION_ERROR', () => {
  const req = makeReq({
    method: 'PATCH',
    headers: {
      'content-type': 'text/plain',
      'content-length': '5',
    },
  });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  const err = next.get();
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'VALIDATION_ERROR');
});

test('requireJson — PUT with no Content-Type and chunked body returns error', () => {
  const req = makeReq({
    method: 'PUT',
    headers: {
      'transfer-encoding': 'chunked',
    },
  });
  const res = makeRes();
  const next = captureNext();

  requireJson(req, res, next);
  const err = next.get();
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'VALIDATION_ERROR');
});

// ── validate-uuid-param middleware ────────────────────────────────────────────

const { validateUuidParam } = require('../../server/middleware/validate-uuid-param');

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

test('validateUuidParam — valid UUID passes through', () => {
  const mw = validateUuidParam('id');
  const req = makeReq({ params: { id: VALID_UUID } });
  const res = makeRes();
  const next = captureNext();

  mw(req, res, next);
  assert.equal(next.get(), undefined);
});

test('validateUuidParam — uppercase UUID passes through', () => {
  const mw = validateUuidParam('id');
  const req = makeReq({ params: { id: VALID_UUID.toUpperCase() } });
  const res = makeRes();
  const next = captureNext();

  mw(req, res, next);
  assert.equal(next.get(), undefined);
});

test('validateUuidParam — missing param returns VALIDATION_ERROR', () => {
  const mw = validateUuidParam('id');
  const req = makeReq({ params: {} });
  const res = makeRes();
  const next = captureNext();

  mw(req, res, next);
  const err = next.get();
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.equal(err.status, 400);
});

test('validateUuidParam — non-UUID string returns VALIDATION_ERROR', () => {
  const mw = validateUuidParam('id');
  const req = makeReq({ params: { id: 'not-a-uuid' } });
  const res = makeRes();
  const next = captureNext();

  mw(req, res, next);
  const err = next.get();
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.ok(err.message.includes('id'));
});

test('validateUuidParam — SQL injection attempt returns VALIDATION_ERROR', () => {
  const mw = validateUuidParam('id');
  const req = makeReq({ params: { id: "'; DROP TABLE users; --" } });
  const res = makeRes();
  const next = captureNext();

  mw(req, res, next);
  assert.ok(next.get() instanceof AppError);
});

test('validateUuidParam — uses supplied param name in error message', () => {
  const mw = validateUuidParam('taskId');
  const req = makeReq({ params: { taskId: 'bad' } });
  const res = makeRes();
  const next = captureNext();

  mw(req, res, next);
  const err = next.get();
  assert.ok(err.message.includes('taskId'));
});

test('validateUuidParam — works with different param names', () => {
  for (const paramName of ['id', 'taskId', 'reportId', 'userId']) {
    const mw = validateUuidParam(paramName);
    const req = makeReq({ params: { [paramName]: VALID_UUID } });
    const res = makeRes();
    const next = captureNext();
    mw(req, res, next);
    assert.equal(next.get(), undefined, `param=${paramName} should pass`);
  }
});
