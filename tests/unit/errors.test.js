// tests/unit/errors.test.js
// Unit tests for AppError and ErrorCodes (server/utils/errors.js).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError, ErrorCodes } = require('../../server/utils/errors');

test('AppError — constructor stores code, message and status', () => {
  const err = new AppError('NOT_FOUND', 'Thing not found', 404);
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'Thing not found');
  assert.equal(err.status, 404);
  assert.ok(err instanceof Error);
});

test('AppError — status defaults to STATUS_BY_CODE lookup', () => {
  const err = new AppError(ErrorCodes.UNAUTHORIZED, 'Nope');
  assert.equal(err.status, 401);
});

test('AppError — status falls back to 500 for unknown code', () => {
  const err = new AppError('MADE_UP_CODE', 'Custom');
  assert.equal(err.status, 500);
});

test('AppError — message defaults to code when not supplied', () => {
  const err = new AppError(ErrorCodes.FORBIDDEN);
  assert.equal(err.message, ErrorCodes.FORBIDDEN);
});

test('ErrorCodes — all defined codes map to an HTTP status', () => {
  // STATUS_BY_CODE is internal, but we can verify through AppError.
  const expectedStatuses = {
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    VALIDATION_ERROR: 400,
    RATE_LIMITED: 429,
    TASK_NOT_FOUND: 404,
    TASK_NOT_AVAILABLE: 409,
    TASK_ALREADY_COMPLETED: 409,
    SELF_TASK_FORBIDDEN: 403,
    INSUFFICIENT_CREDITS: 402,
    INSUFFICIENT_BUDGET: 409,
    VERIFICATION_PENDING: 409,
    VERIFICATION_ALREADY_REVIEWED: 409,
    CAMPAIGN_NOT_ACTIVE: 409,
    CAMPAIGN_COMPLETED: 409,
    CAMPAIGN_CANCELLED: 409,
  };

  for (const [code, expectedStatus] of Object.entries(expectedStatuses)) {
    const err = new AppError(code, 'test');
    assert.equal(
      err.status,
      expectedStatus,
      `${code} should map to ${expectedStatus}, got ${err.status}`
    );
  }
});

test('ErrorCodes — exported constants match expected keys', () => {
  const expected = [
    'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION_ERROR',
    'RATE_LIMITED', 'TASK_NOT_FOUND', 'TASK_NOT_AVAILABLE',
    'TASK_ALREADY_COMPLETED', 'SELF_TASK_FORBIDDEN',
    'INSUFFICIENT_CREDITS', 'INSUFFICIENT_BUDGET',
    'VERIFICATION_PENDING', 'VERIFICATION_ALREADY_REVIEWED',
    'CAMPAIGN_NOT_ACTIVE', 'CAMPAIGN_COMPLETED', 'CAMPAIGN_CANCELLED',
  ];
  for (const key of expected) {
    assert.ok(Object.prototype.hasOwnProperty.call(ErrorCodes, key),
      `ErrorCodes missing: ${key}`);
  }
});
