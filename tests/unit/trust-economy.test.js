// tests/unit/trust-economy.test.js
// The API side of 021_trust_and_economy.sql: screenshot fingerprints,
// the account a proof names, appeals and undone-action reports, the doer
// track record and waiting-proof limit on the lists, the admin decisions,
// the welcome-bonus progress and places left on a task.

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

// ── a programmable stand-in for supabase-js ──────────────────────────────────

const calls = [];
let rpcResults = {};
let tableRows = {};
let insertError = null;

function fakeQuery(table) {
  const filters = [];
  const q = {
    select: () => q,
    eq: (col, val) => { filters.push(['eq', col, val]); return q; },
    in: (col, vals) => { filters.push(['in', col, vals]); return q; },
    lt: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: (tableRows[table] || [])[0] || null, error: null }),
    insert: async (row) => { calls.push(['insert', table, row]); return { error: insertError }; },
    // awaiting the query runs it
    then: (resolve) => { calls.push(['select', table, filters.slice()]); return resolve({ data: tableRows[table] || [], error: null }); },
  };
  return q;
}

function fakeClient() {
  return {
    storage: {
      from: (bucket) => ({
        upload: async (path) => { calls.push(['upload', bucket, path]); return { error: null }; },
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://cdn.test/${p}` })), error: null }),
      }),
    },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return rpcResults[name] || { data: null, error: null };
    },
    from: (table) => fakeQuery(table),
  };
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: fakeClient };
  return originalLoad.call(this, request, ...rest);
};

const verification = require('../../server/services/verification.service');
const admin = require('../../server/services/admin.service');
const credits = require('../../server/services/credit.service');
const { placesLeft } = require('../../server/services/task.service');
const { validateSubmit, validateMessage } = require('../../server/validators/verification.validator');
const { validateDecisionNote } = require('../../server/validators/admin.validator');

const USER = '11111111-1111-4111-8111-111111111111';
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 data')]);

beforeEach(() => {
  calls.length = 0;
  rpcResults = {};
  tableRows = {};
  insertError = null;
});

// ── validators ───────────────────────────────────────────────────────────────

test('validateSubmit: the linked account must be an id', () => {
  const proof = { proof_url: 'https://instagram.com/p/1' };
  assert.deepEqual(validateSubmit({ ...proof, social_profile_id: '22222222-2222-4222-8222-222222222222' }), []);
  assert.deepEqual(validateSubmit({ ...proof, social_profile_id: null }), []);
  assert.ok(validateSubmit({ ...proof, social_profile_id: '1 or 1=1' }).includes('Choose one of your linked accounts'));
});

test('validateMessage: appeals and reports need a short explanation', () => {
  assert.deepEqual(validateMessage({ message: 'I followed from @me, see screenshot' }), []);
  assert.deepEqual(validateMessage({ message: '  short  ' }), ['Explain in at least 10 characters']);
  assert.deepEqual(validateMessage({}), ['Explain in at least 10 characters']);
  assert.deepEqual(validateMessage({ message: 'x'.repeat(1001) }), ['Keep it under 1000 characters']);
});

test('validateDecisionNote: the admin note is optional text', () => {
  assert.deepEqual(validateDecisionNote({}), []);
  assert.deepEqual(validateDecisionNote({ note: 'Screenshot shows it' }), []);
  assert.equal(validateDecisionNote({ note: 5 }).length, 1);
  assert.equal(validateDecisionNote({ note: 'x'.repeat(1001) }).length, 1);
});

// ── screenshot fingerprints ──────────────────────────────────────────────────

test('uploadProofImage records the image fingerprint with its path', async () => {
  const { path } = await verification.uploadProofImage(USER, WEBP, 'image/webp');
  const sha = crypto.createHash('sha256').update(WEBP).digest('hex');
  const lookup = calls.find((c) => c[0] === 'select' && c[1] === 'task_verifications');
  assert.deepEqual(lookup[2], [['eq', 'proof_image_sha', sha]]);
  const insert = calls.find((c) => c[0] === 'insert');
  assert.deepEqual(insert, ['insert', 'proof_images', { path, user_id: USER, sha256: sha }]);
});

test('uploadProofImage refuses an image already used as proof - before storing it', async () => {
  tableRows.task_verifications = [{ id: 'v1' }];
  await assert.rejects(verification.uploadProofImage(USER, WEBP, 'image/webp'),
    (err) => err.code === 'DUPLICATE_PROOF' && err.status === 409 && err.message === 'this screenshot was already used as proof');
  assert.equal(calls.some((c) => c[0] === 'upload'), false, 'nothing may reach storage');
});

test('uploadProofImage fails if the fingerprint cannot be recorded', async () => {
  insertError = { message: 'insert failed' };
  await assert.rejects(verification.uploadProofImage(USER, WEBP, 'image/webp'), (err) => err.status === 500);
});

// ── submit with the account used ─────────────────────────────────────────────

test('submit passes the linked account to submit_task_verification', async () => {
  rpcResults.submit_task_verification = { data: 'c1', error: null };
  tableRows.completion_details = [{ id: 'c1' }];
  await verification.submit('token', 'task-1', { proof_url: 'https://x.com/p', social_profile_id: 'acc-1' });
  assert.deepEqual(calls[0], ['rpc', 'submit_task_verification', {
    p_task_id: 'task-1', p_proof_url: 'https://x.com/p', p_proof_text: null, p_proof_image_path: null, p_social_profile_id: 'acc-1',
  }]);
});

test('the new database refusals keep their own codes', async () => {
  for (const [message, code, status] of [
    ['ACCOUNT_REQUIRED: choose the account you did this task from', 'ACCOUNT_REQUIRED', 400],
    ['PENDING_LIMIT: too many of your proofs are waiting for review', 'PENDING_LIMIT', 409],
    ['DUPLICATE_PROOF: this screenshot was already used as proof', 'DUPLICATE_PROOF', 409],
  ]) {
    rpcResults.submit_task_verification = { data: null, error: { message } };
    await assert.rejects(verification.submit('token', 'task-1', { proof_text: 'done' }),
      (err) => err.code === code && err.status === status && err.message === message.split(': ')[1], code);
  }
});

// ── appeals and undone actions ───────────────────────────────────────────────

test('appeal goes through appeal_rejection with the member\'s message', async () => {
  tableRows.completion_details = [{ id: 'c1', status: 'rejected', appeal_status: 'open' }];
  const completion = await verification.appeal('token', 'c1', { message: 'Please look again' });
  assert.deepEqual(calls[0], ['rpc', 'appeal_rejection', { p_completion_id: 'c1', p_message: 'Please look again' }]);
  assert.equal(completion.appeal_status, 'open');
});

test('reportUndone goes through report_unfollow and maps refusals', async () => {
  rpcResults.report_unfollow = { data: null, error: { message: 'VALIDATION_ERROR: a visit cannot be undone' } };
  await assert.rejects(verification.reportUndone('token', 'c1', { message: 'He unfollowed me' }),
    (err) => err.code === 'VALIDATION_ERROR' && err.message === 'a visit cannot be undone');
  assert.deepEqual(calls[0], ['rpc', 'report_unfollow', { p_completion_id: 'c1', p_message: 'He unfollowed me' }]);
});

// ── lists: track record and limit ────────────────────────────────────────────

test('the review list carries each member\'s track record', async () => {
  tableRows.completion_details = [
    { id: 'a', completer_id: 'u1', created_at: '2026-10-08T10:00:00Z' },
    { id: 'b', completer_id: 'u2', created_at: '2026-10-08T09:00:00Z' },
  ];
  rpcResults.doer_review_stats = { data: [{ user_id: 'u1', approved: '7', rejected: '1', reversed: '0', trusted: true }], error: null };
  const { completions } = await verification.listToReview('token', 'creator', {});
  const statsCall = calls.find((c) => c[1] === 'doer_review_stats');
  assert.deepEqual(statsCall[2], { p_user_ids: ['u1', 'u2'] });
  assert.deepEqual(completions[0].completer_stats, { approved: 7, rejected: 1, reversed: 0, trusted: true });
  assert.equal(completions[1].completer_stats, null);
});

test('my list carries the waiting-proof limit', async () => {
  tableRows.completion_details = [];
  rpcResults.get_my_proof_limits = { data: [{ pending_count: 3, pending_limit: 15, level: 2, trusted: true }], error: null };
  const result = await verification.listMine('token', 'me', {});
  assert.deepEqual(result.limits, { pending_count: 3, pending_limit: 15, level: 2, trusted: true });
});

// ── admin decisions ──────────────────────────────────────────────────────────

test('admin overturn and reverse call their functions as the admin', async () => {
  await admin.overturnRejection('admin-token', 'c1', { note: 'Looks right' });
  assert.deepEqual(calls[0], ['rpc', 'admin_overturn_rejection', { p_completion_id: 'c1', p_note: 'Looks right' }]);

  rpcResults.admin_reverse_reward = { data: 4, error: null };
  const result = await admin.reverseReward('admin-token', 'c1', {});
  assert.deepEqual(calls[1], ['rpc', 'admin_reverse_reward', { p_completion_id: 'c1', p_note: null }]);
  assert.deepEqual(result, { taken_back: 4 });

  rpcResults.admin_overturn_rejection = { data: null, error: { message: 'CAMPAIGN_CANCELLED: campaign is no longer reviewable' } };
  await assert.rejects(admin.overturnRejection('admin-token', 'c2', {}), (err) => err.code === 'CAMPAIGN_CANCELLED' && err.status === 409);
});

test('admin reports carry the proof they are about', async () => {
  tableRows.reports = [
    { id: 'r1', reporter_id: 'u1', report_type: 'proof_appeal', related_completion_id: 'c1', created_at: '2026-10-08T10:00:00Z' },
    { id: 'r2', reporter_id: 'u1', report_type: 'spam', related_completion_id: null, created_at: '2026-10-08T09:00:00Z' },
  ];
  tableRows.profiles = [{ id: 'u1', username: 'ivy' }];
  tableRows.completion_details = [{ id: 'c1', status: 'rejected', proof_image_path: 'u1/x.webp' }];
  const { reports } = await admin.listReports({ status: 'open' });
  assert.equal(reports[0].completion.id, 'c1');
  assert.equal(reports[0].completion.proof_image_url, 'https://cdn.test/u1/x.webp');
  assert.equal(reports[1].completion, null);
});

// ── welcome bonus and places ─────────────────────────────────────────────────

test('welcome-bonus progress comes from get_starter_bonus', async () => {
  rpcResults.get_starter_bonus = { data: [{ creators_done: 2, creators_needed: 3, amount: 10, granted_at: null }], error: null };
  assert.deepEqual(await credits.getWelcomeBonus('token'), { creators_done: 2, creators_needed: 3, amount: 10, granted_at: null });
});

test('placesLeft counts proofs waiting for review as taken', () => {
  const c = { status: 'active', reward: 10, desired_completions: 5, completed_count: 1, reserved_count: 2, remaining_budget: 40 };
  assert.equal(placesLeft(c), 2);
  assert.equal(placesLeft({ ...c, reserved_count: 4 }), 0);
  assert.equal(placesLeft({ ...c, status: 'paused' }), 0);
  assert.equal(placesLeft({ ...c, remaining_budget: 25 }), 0, 'budget for 2 places, both held');
});
