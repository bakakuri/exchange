// tests/unit/verification-upgrades.test.js
// The API side of 020_verification_upgrades.sql: proof validation with
// screenshots, the link-click task-type rule, the screenshot upload
// (type sniffing, own-folder paths), the raw-upload exemption in
// requireJson, and which RPCs the link-click endpoints call.

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── Stub supabase-js before anything requires it ─────────────────────────────

const calls = [];
let uploadError = null;
let rpcResult = { data: null, error: null };

function fakeClient() {
  return {
    storage: {
      from: (bucket) => ({
        upload: async (path, body, opts) => { calls.push(['upload', bucket, path, opts.contentType, body.length]); return { error: uploadError }; },
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://cdn.test/${p}?token=x` })), error: null }),
      }),
    },
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return rpcResult; },
    from: () => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { id: 'c1', proof_image_path: 'u/p.webp' }, error: null }),
      };
      return q;
    },
  };
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: fakeClient };
  return originalLoad.call(this, request, ...rest);
};

const service = require('../../server/services/verification.service');
const { validateSubmit, PROOF_IMAGE_PATH_RE } = require('../../server/validators/verification.validator');
const { validateCreate } = require('../../server/validators/campaign.validator');
const { requireJson } = require('../../server/middleware/require-json');

const USER = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

beforeEach(() => { calls.length = 0; uploadError = null; rpcResult = { data: null, error: null }; });

// ── validateSubmit ────────────────────────────────────────────────────────────

test('validateSubmit: a screenshot alone is enough proof', () => {
  assert.deepEqual(validateSubmit({ proof_image_path: `${USER}/22222222-2222-4222-8222-222222222222.webp` }), []);
});

test('validateSubmit: no link, note or screenshot is refused', () => {
  assert.deepEqual(validateSubmit({}), ['Add a link, a note or a screenshot as proof']);
});

test('validateSubmit: a malformed screenshot path is refused', () => {
  for (const bad of ['../etc/passwd', `${USER}/x.gif`, 'a/b.png', `${USER}/22222222-2222-4222-8222-222222222222.png/../x`]) {
    assert.ok(validateSubmit({ proof_image_path: bad }).includes('Invalid screenshot'), bad);
  }
  assert.match(`${USER}/22222222-2222-4222-8222-222222222222.jpg`, PROOF_IMAGE_PATH_RE);
});

// ── campaign: link click only for visits ─────────────────────────────────────

const campaign = (over) => ({
  title: 'T', platform: 'instagram', task_type: 'follow', target_url: 'https://instagram.com/x',
  reward: 5, desired_completions: 2, verification_method: 'manual_proof', ...over,
});

test('validateCreate: link click is refused for a follow task', () => {
  assert.ok(validateCreate(campaign({ verification_method: 'link_click' }))
    .includes('Link-click checking is only for Visit, View and Listen tasks'));
});

test('validateCreate: link click is fine for visit / view / listen', () => {
  for (const task_type of ['visit', 'view', 'listen']) {
    assert.deepEqual(validateCreate(campaign({ task_type, verification_method: 'link_click' })), [], task_type);
  }
});

// ── requireJson: the one binary upload ───────────────────────────────────────

function runRequireJson(path, contentType) {
  let passed = null;
  requireJson({ method: 'POST', path, headers: { 'content-type': contentType, 'content-length': '10' } }, {}, (err) => { passed = err || true; });
  return passed;
}

test('requireJson: an image may be posted to the proof upload', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(runRequireJson('/api/verification/proof-image', type), true, type);
  }
});

test('requireJson: images anywhere else, and other types on the upload, are still refused', () => {
  assert.equal(runRequireJson('/api/profile/me', 'image/png').status, 415);
  assert.equal(runRequireJson('/api/verification/proof-image', 'text/plain').status, 415);
  assert.equal(runRequireJson('/api/verification/proof-image', 'image/gif').status, 415);
});

// ── screenshot upload ────────────────────────────────────────────────────────

test('sniffImage recognises JPEG, PNG and WebP by their bytes', () => {
  assert.equal(service.sniffImage(JPEG).type, 'image/jpeg');
  assert.equal(service.sniffImage(PNG).type, 'image/png');
  assert.equal(service.sniffImage(WEBP).type, 'image/webp');
  assert.equal(service.sniffImage(Buffer.from('GIF89a......')), null);
});

test('uploadProofImage stores the file in the uploader\'s own folder of the private bucket', async () => {
  const { path } = await service.uploadProofImage(USER, WEBP, 'image/webp');
  assert.match(path, new RegExp(`^${USER}/[0-9a-f-]{36}\\.webp$`));
  assert.match(path, PROOF_IMAGE_PATH_RE);
  const [kind, bucket, storedPath, type] = calls[0];
  assert.deepEqual([kind, bucket, storedPath, type], ['upload', 'proofs', path, 'image/webp']);
});

test('uploadProofImage refuses a file whose bytes don\'t match its declared type', async () => {
  await assert.rejects(service.uploadProofImage(USER, PNG, 'image/jpeg'), /JPEG, PNG or WebP/);
  await assert.rejects(service.uploadProofImage(USER, Buffer.from('<svg/>'), 'image/png'), /JPEG, PNG or WebP/);
  await assert.rejects(service.uploadProofImage(USER, Buffer.alloc(0), 'image/png'), /Choose an image/);
  assert.equal(calls.length, 0, 'nothing may reach storage');
});

test('uploadProofImage hides storage errors behind a 500', async () => {
  uploadError = { message: 'bucket not found' };
  await assert.rejects(service.uploadProofImage(USER, JPEG, 'image/jpeg'), (err) => err.status === 500);
});

// ── link-click endpoints ─────────────────────────────────────────────────────

test('openLink records the click through record_task_link_click and returns the wait', async () => {
  rpcResult = { data: '2026-10-08T10:00:00Z', error: null };
  const result = await service.openLink('token', 'task-1');
  assert.deepEqual(calls[0], ['rpc', 'record_task_link_click', { p_task_id: 'task-1' }]);
  assert.equal(result.clicked_at, '2026-10-08T10:00:00Z');
  assert.equal(result.wait_seconds, 15);
});

test('completeLink pays through complete_link_click_task and maps database errors', async () => {
  rpcResult = { data: null, error: { message: 'VALIDATION_ERROR: keep the page open for at least 15 seconds' } };
  await assert.rejects(service.completeLink('token', 'task-1'), (err) => err.code === 'VALIDATION_ERROR'
    && err.message === 'keep the page open for at least 15 seconds');
  assert.deepEqual(calls[0], ['rpc', 'complete_link_click_task', { p_task_id: 'task-1' }]);
});

test('a completion comes back with a signed URL for its screenshot', async () => {
  rpcResult = { data: 'c1', error: null };
  const completion = await service.completeLink('token', 'task-1');
  assert.equal(completion.proof_image_url, 'https://cdn.test/u/p.webp?token=x');
});
