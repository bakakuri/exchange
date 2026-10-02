// tests/unit/error-handler.test.js
// The central error handler must never send raw database text to the
// client, and every AppError response must carry a defined code.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError, ErrorCodes } = require('../../server/utils/errors');
const { errorHandler } = require('../../server/middleware/error-handler');
const logger = require('../../server/utils/logger');

function run(err) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const originalError = logger.error;
  logger.error = () => {}; // keep test output clean
  try {
    errorHandler(err, { requestId: 'req-1' }, res, () => {});
  } finally {
    logger.error = originalError;
  }
  return res;
}

test('DB_ERROR is a defined code mapped to 500', () => {
  assert.equal(ErrorCodes.DB_ERROR, 'DB_ERROR');
  assert.equal(new AppError(ErrorCodes.DB_ERROR, 'x').status, 500);
});

test('5xx AppError: generic message, raw DB text never sent', () => {
  const res = run(new AppError(ErrorCodes.DB_ERROR, 'column audit_logs.entity_type does not exist'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'DB_ERROR');
  assert.equal(res.body.error.message, 'Something went wrong.');
  assert.equal(res.body.requestId, 'req-1');
});

test('TIMEOUT keeps its own (safe) message', () => {
  const res = run(new AppError(ErrorCodes.TIMEOUT, 'Request timed out', 503));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.message, 'Request timed out');
});

test('4xx AppError: message passes through unchanged', () => {
  const res = run(new AppError(ErrorCodes.VALIDATION_ERROR, 'Title is required'));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.message, 'Title is required');
});

test('non-AppError: 500 INTERNAL_ERROR with generic message', () => {
  const res = run(new Error('boom'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, 'Something went wrong.');
});
