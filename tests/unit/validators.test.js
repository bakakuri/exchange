// tests/unit/validators.test.js
// Unit tests for all server validator functions.
// Validators are pure functions (body → string[]) — no network, no Supabase.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateRegister,
  validateLogin,
  validatePasswordResetRequest,
  validatePasswordResetConfirm,
  validateRefresh,
} = require('../../server/validators/auth.validator');

const {
  validateUpdateUser,
  validateCreditAdjustment,
} = require('../../server/validators/admin.validator');

const {
  validateSubmitReport,
  validateResolveReport,
} = require('../../server/validators/reports.validator');

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

// ── Auth validators ──────────────────────────────────────────────────────────

test('validateRegister — valid body returns no errors', () => {
  const errs = validateRegister({
    email: 'user@example.com',
    password: 'securepassword',
    username: 'alice_42',
  });
  assert.deepEqual(errs, []);
});

test('validateRegister — missing email produces error', () => {
  const errs = validateRegister({ password: 'password123' });
  assert.ok(errs.some((e) => e.includes('email')));
});

test('validateRegister — invalid email format produces error', () => {
  const errs = validateRegister({ email: 'notanemail', password: 'password123' });
  assert.ok(errs.some((e) => e.includes('email')));
});

test('validateRegister — short password produces error', () => {
  const errs = validateRegister({ email: 'user@example.com', password: 'short' });
  assert.ok(errs.some((e) => e.includes('8 characters')));
});

test('validateRegister — invalid username format produces error', () => {
  const errs = validateRegister({
    email: 'user@example.com',
    password: 'password123',
    username: 'has space!',
  });
  assert.ok(errs.some((e) => e.includes('Username')));
});

test('validateRegister — username is optional', () => {
  const errs = validateRegister({ email: 'user@example.com', password: 'password123' });
  assert.deepEqual(errs, []);
});

test('validateLogin — valid body returns no errors', () => {
  const errs = validateLogin({ email: 'user@example.com', password: 'anything' });
  assert.deepEqual(errs, []);
});

test('validateLogin — missing password produces error', () => {
  const errs = validateLogin({ email: 'user@example.com' });
  assert.ok(errs.some((e) => e.includes('Password')));
});

test('validatePasswordResetRequest — valid email', () => {
  assert.deepEqual(validatePasswordResetRequest({ email: 'a@b.com' }), []);
});

test('validatePasswordResetRequest — missing email', () => {
  assert.ok(validatePasswordResetRequest({}).length > 0);
});

test('validatePasswordResetConfirm — valid body', () => {
  assert.deepEqual(
    validatePasswordResetConfirm({ access_token: 'tok', password: 'newpassword' }),
    []
  );
});

test('validatePasswordResetConfirm — missing token', () => {
  const errs = validatePasswordResetConfirm({ password: 'newpassword' });
  assert.ok(errs.some((e) => e.includes('token')));
});

test('validateRefresh — valid body', () => {
  assert.deepEqual(validateRefresh({ refresh_token: 'tok' }), []);
});

test('validateRefresh — missing token', () => {
  assert.ok(validateRefresh({}).length > 0);
});

// ── Admin validators ──────────────────────────────────────────────────────────

test('validateUpdateUser — valid body returns no errors', () => {
  const errs = validateUpdateUser({
    role: 'user',
    status: 'active',
    reason: 'Routine update',
  });
  assert.deepEqual(errs, []);
});

test('validateUpdateUser — accepts all valid roles', () => {
  for (const role of ['user', 'moderator', 'admin']) {
    const errs = validateUpdateUser({ role, status: 'active', reason: 'ok' });
    assert.ok(!errs.some((e) => e.includes('role')), `role=${role} should be valid`);
  }
});

test('validateUpdateUser — rejects invalid role', () => {
  const errs = validateUpdateUser({ role: 'superuser', status: 'active', reason: 'ok' });
  assert.ok(errs.some((e) => e.includes('role')));
});

test('validateUpdateUser — rejects invalid status', () => {
  const errs = validateUpdateUser({ role: 'user', status: 'banned', reason: 'ok' });
  assert.ok(errs.some((e) => e.includes('status')));
});

test('validateUpdateUser — rejects missing reason', () => {
  const errs = validateUpdateUser({ role: 'user', status: 'active' });
  assert.ok(errs.some((e) => e.includes('reason')));
});

test('validateUpdateUser — rejects short reason', () => {
  const errs = validateUpdateUser({ role: 'user', status: 'active', reason: 'ok' });
  assert.ok(errs.some((e) => e.includes('reason')));
});

test('validateCreditAdjustment — valid positive amount', () => {
  assert.deepEqual(
    validateCreditAdjustment({ amount: 100, reason: 'Bonus credit' }),
    []
  );
});

test('validateCreditAdjustment — valid negative amount', () => {
  assert.deepEqual(
    validateCreditAdjustment({ amount: -50, reason: 'Deduction for X' }),
    []
  );
});

test('validateCreditAdjustment — rejects zero', () => {
  const errs = validateCreditAdjustment({ amount: 0, reason: 'Should fail' });
  assert.ok(errs.some((e) => e.includes('non-zero')));
});

test('validateCreditAdjustment — rejects non-integer', () => {
  const errs = validateCreditAdjustment({ amount: 10.5, reason: 'fractions' });
  assert.ok(errs.some((e) => e.includes('integer')));
});

test('validateCreditAdjustment — rejects missing reason', () => {
  const errs = validateCreditAdjustment({ amount: 10 });
  assert.ok(errs.some((e) => e.includes('reason')));
});

// ── Reports validators ────────────────────────────────────────────────────────

test('validateSubmitReport — valid body with task target', () => {
  const errs = validateSubmitReport({
    report_type: 'spam',
    description: 'This task is clearly spam content.',
    related_task_id: VALID_UUID,
  });
  assert.deepEqual(errs, []);
});

test('validateSubmitReport — valid body with campaign target', () => {
  const errs = validateSubmitReport({
    report_type: 'fraud',
    description: 'Fraudulent campaign posting.',
    related_campaign_id: VALID_UUID,
  });
  assert.deepEqual(errs, []);
});

test('validateSubmitReport — valid body with user target', () => {
  const errs = validateSubmitReport({
    report_type: 'abuse',
    description: 'User harassing other members.',
    related_user_id: VALID_UUID,
  });
  assert.deepEqual(errs, []);
});

test('validateSubmitReport — accepts all valid report types', () => {
  const types = ['spam', 'fraud', 'invalid_task', 'inappropriate_content', 'broken_url', 'abuse'];
  for (const report_type of types) {
    const errs = validateSubmitReport({
      report_type,
      description: 'Long enough description here.',
      related_task_id: VALID_UUID,
    });
    assert.ok(!errs.some((e) => e.includes('report_type')),
      `report_type=${report_type} should be valid`);
  }
});

test('validateSubmitReport — rejects invalid report type', () => {
  const errs = validateSubmitReport({
    report_type: 'hate_speech',
    description: 'Long enough description here.',
    related_task_id: VALID_UUID,
  });
  assert.ok(errs.some((e) => e.includes('report_type')));
});

test('validateSubmitReport — rejects missing report type', () => {
  const errs = validateSubmitReport({
    description: 'Long enough description here.',
    related_task_id: VALID_UUID,
  });
  assert.ok(errs.some((e) => e.includes('report_type')));
});

test('validateSubmitReport — rejects short description', () => {
  const errs = validateSubmitReport({
    report_type: 'spam',
    description: 'Too short',
    related_task_id: VALID_UUID,
  });
  assert.ok(errs.some((e) => e.includes('10 characters')));
});

test('validateSubmitReport — rejects description > 2000 chars', () => {
  const errs = validateSubmitReport({
    report_type: 'spam',
    description: 'a'.repeat(2001),
    related_task_id: VALID_UUID,
  });
  assert.ok(errs.some((e) => e.includes('2000 characters')));
});

test('validateSubmitReport — rejects missing target', () => {
  const errs = validateSubmitReport({
    report_type: 'spam',
    description: 'Long enough description here.',
  });
  assert.ok(errs.some((e) => e.includes('related_')));
});

test('validateSubmitReport — rejects malformed UUID in related_task_id', () => {
  const errs = validateSubmitReport({
    report_type: 'spam',
    description: 'Long enough description here.',
    related_task_id: 'not-a-uuid',
  });
  assert.ok(errs.some((e) => e.includes('UUID')));
});

test('validateResolveReport — valid resolved decision', () => {
  assert.deepEqual(
    validateResolveReport({ decision: 'resolved', note: 'Confirmed spam.' }),
    []
  );
});

test('validateResolveReport — valid dismissed decision', () => {
  assert.deepEqual(
    validateResolveReport({ decision: 'dismissed', note: '' }),
    []
  );
});

test('validateResolveReport — note is optional', () => {
  assert.deepEqual(validateResolveReport({ decision: 'resolved' }), []);
});

test('validateResolveReport — rejects invalid decision', () => {
  const errs = validateResolveReport({ decision: 'deleted' });
  assert.ok(errs.some((e) => e.includes('decision')));
});

test('validateResolveReport — rejects note > 1000 chars', () => {
  const errs = validateResolveReport({ decision: 'resolved', note: 'x'.repeat(1001) });
  assert.ok(errs.some((e) => e.includes('1000 characters')));
});
