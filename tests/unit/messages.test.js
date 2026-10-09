// tests/unit/messages.test.js
// The API side of 023_messages.sql: request validation, upload paths (the
// shape send_message() accepts), signed file links (photos inline,
// documents as downloads under their own name), one-time upload URLs, the
// poll, deleting a message with its file, and the ?conversation check.

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── a programmable stand-in for supabase-js ──────────────────────────────────

const calls = [];
let rpcResults = {};
let signingFails = false;

function fakeClient() {
  return {
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths, seconds) => {
          calls.push(['signMany', bucket, paths, seconds]);
          if (signingFails) return { data: null, error: { message: 'storage down' } };
          return { data: paths.map((p) => ({ path: p, signedUrl: `https://cdn/${p}?t=1` })), error: null };
        },
        createSignedUrl: async (path, seconds, opts) => {
          calls.push(['signOne', bucket, path, seconds, opts]);
          if (signingFails) return { data: null, error: { message: 'storage down' } };
          return { data: { signedUrl: `https://cdn/${path}?download=${encodeURIComponent(opts?.download)}` }, error: null };
        },
        createSignedUploadUrl: async (path) => {
          calls.push(['uploadUrl', bucket, path]);
          return { data: { signedUrl: `https://proj.supabase.co/storage/v1/object/upload/sign/${bucket}/${path}?token=x`, path, token: 'x' }, error: null };
        },
        remove: async (paths) => { calls.push(['remove', bucket, paths]); return { error: null }; },
      }),
    },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      const result = rpcResults[name];
      return typeof result === 'function' ? result(args) : result || { data: null, error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: OTHER }, error: null }) }) }) }),
  };
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: fakeClient };
  return originalLoad.call(this, request, ...rest);
};

const messages = require('../../server/services/messages.service');
const {
  validateStart, validateSend, validateUpload, validateRead, validateBlock, validateUpdatesQuery,
} = require('../../server/validators/messages.validator');

// The route table needs express installed (npm install); without it those
// checks are skipped.
let router = null;
try {
  router = require('../../server/routes/messages.routes');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CONV = '33333333-3333-4333-8333-333333333333';
const CLIENT = '44444444-4444-4444-8444-444444444444';
// The path rule send_message() enforces.
const PATH_RE = new RegExp(`^${CONV}/${USER}/[0-9a-f-]{36}(\\.[a-z0-9]{1,10})?$`);

beforeEach(() => {
  calls.length = 0;
  rpcResults = {};
  signingFails = false;
});

// ── validators ───────────────────────────────────────────────────────────────

test('validateSend: text needs words, at most 4000 characters', () => {
  assert.deepEqual(validateSend({ kind: 'text', body: 'Hi!' }), []);
  assert.deepEqual(validateSend({ kind: 'text', body: '   ' }), ['Write a message']);
  assert.deepEqual(validateSend({ kind: 'text', body: 'x'.repeat(4001) }), ['A message can be at most 4000 characters']);
  assert.deepEqual(validateSend({ kind: 'text', body: 'x'.repeat(4000) }), []);
  assert.match(validateSend({ kind: 'sticker', body: 'x' })[0], /^kind must be one of/);
});

test('validateSend: files need a path and a name; meta is a small object; client_id a UUID', () => {
  const file = { path: `${CONV}/${USER}/abc.pdf`, name: 'brief.pdf', type: 'application/pdf', size: 1200 };
  assert.deepEqual(validateSend({ kind: 'file', attachment: file }), []);
  assert.deepEqual(validateSend({ kind: 'voice', attachment: file, meta: { duration_ms: 3000, waveform: [1, 2] } }), []);
  assert.deepEqual(validateSend({ kind: 'image' }), ['Invalid file']);
  assert.deepEqual(validateSend({ kind: 'image', attachment: { ...file, name: '' } }), ['Invalid file']);
  assert.deepEqual(validateSend({ kind: 'image', attachment: { ...file, size: -1 } }), ['Invalid file']);
  assert.deepEqual(validateSend({ kind: 'image', attachment: { ...file, size: 1.5 } }), ['Invalid file']);
  assert.deepEqual(validateSend({ kind: 'file', attachment: file, meta: [] }), ['Invalid message details']);
  assert.deepEqual(validateSend({ kind: 'file', attachment: file, meta: { w: 'x'.repeat(5000) } }), ['Invalid message details']);
  assert.deepEqual(validateSend({ kind: 'text', body: 'hi', client_id: 'nope' }), ['client_id must be a UUID']);
  assert.deepEqual(validateSend({ kind: 'text', body: 'hi', client_id: CLIENT }), []);
});

test('validateStart / validateUpload / validateRead / validateBlock', () => {
  assert.deepEqual(validateStart({ user_id: OTHER }), []);
  assert.deepEqual(validateStart({ user_id: 'x' }), ['user_id must be a UUID']);
  assert.deepEqual(validateStart({ username: 'nino_b' }), []);
  assert.deepEqual(validateStart({ username: 'no spaces' }), ['Member not found']);
  assert.deepEqual(validateStart({}), ['Choose who to write to']);

  assert.deepEqual(validateUpload({ name: 'clip.mp4', type: 'video/mp4', size: 10 }), []);
  assert.deepEqual(validateUpload({ name: '' }), ['Invalid file']);
  assert.deepEqual(validateUpload({ name: 'a', size: -5, type: 7 }), ['Invalid file']);
  // No size limit of our own: a 2 GB file is fine here (Storage decides).
  assert.deepEqual(validateUpload({ name: 'film.mov', size: 2 * 1024 ** 3 }), []);

  assert.deepEqual(validateRead({ seq: 12 }), []);
  assert.deepEqual(validateRead({ seq: '12' }), ['seq must be a whole number']);
  assert.deepEqual(validateBlock({ user_id: OTHER }), []);
  assert.deepEqual(validateBlock({}), ['user_id must be a UUID']);
});

// ── upload paths and URLs ───────────────────────────────────────────────────

test('uploadPath: the sender\'s own folder of the conversation, extension kept in lower case', () => {
  assert.match(messages.uploadPath(CONV, USER, 'Report.PDF'), PATH_RE);
  assert.ok(messages.uploadPath(CONV, USER, 'Report.PDF').endsWith('.pdf'));
  assert.ok(messages.uploadPath(CONV, USER, 'voice.webm').endsWith('.webm'));
  assert.match(messages.uploadPath(CONV, USER, 'no-extension'), new RegExp(`^${CONV}/${USER}/[0-9a-f-]{36}$`));
  assert.match(messages.uploadPath(CONV, USER, 'weird.ext!!'), new RegExp(`^${CONV}/${USER}/[0-9a-f-]{36}$`));
  assert.match(messages.uploadPath(CONV, USER, '../../etc/passwd'), new RegExp(`^${CONV}/${USER}/[0-9a-f-]{36}$`));
  assert.notEqual(messages.uploadPath(CONV, USER, 'a.jpg'), messages.uploadPath(CONV, USER, 'a.jpg'));
});

test('createUpload: checks the member may write, then hands out a one-time URL', async () => {
  const result = await messages.createUpload('tok', CONV, USER, { name: 'Clip.MP4' });
  assert.deepEqual(calls[0], ['rpc', 'assert_can_send', { p_conversation_id: CONV }]);
  assert.equal(calls[1][0], 'uploadUrl');
  assert.equal(calls[1][1], 'chat');
  assert.match(result.path, PATH_RE);
  assert.ok(result.path.endsWith('.mp4'));
  assert.ok(result.upload_url.includes(result.path));
});

test('createUpload: a blocked or outside member gets no URL', async () => {
  rpcResults.assert_can_send = { data: null, error: { message: 'FORBIDDEN: this member does not accept your messages' } };
  await assert.rejects(messages.createUpload('tok', CONV, USER, { name: 'a.jpg' }), (err) => err.status === 403 && err.code === 'FORBIDDEN');
  assert.equal(calls.filter((c) => c[0] === 'uploadUrl').length, 0);
});

// ── signed links ─────────────────────────────────────────────────────────────

test('withUrls: photos, videos and voice in one batch; documents download under their own name', async () => {
  const list = [
    { id: '1', kind: 'text', body: 'hi', attachment_path: null },
    { id: '2', kind: 'image', attachment_path: `${CONV}/${USER}/a.jpg` },
    { id: '3', kind: 'voice', attachment_path: `${CONV}/${USER}/b.webm` },
    { id: '4', kind: 'file', attachment_path: `${CONV}/${USER}/c.pdf`, attachment_name: 'Collab brief.pdf' },
    { id: '5', kind: 'image', attachment_path: null, deleted_at: '2026-10-01T00:00:00Z' },
  ];
  const out = await messages.withUrls(list);
  const many = calls.filter((c) => c[0] === 'signMany');
  assert.equal(many.length, 1);
  assert.deepEqual(many[0][2], [`${CONV}/${USER}/a.jpg`, `${CONV}/${USER}/b.webm`]);
  assert.equal(many[0][3], 6 * 60 * 60);
  const one = calls.find((c) => c[0] === 'signOne');
  assert.deepEqual(one[4], { download: 'Collab brief.pdf' });

  assert.equal(out[0].attachment_url, undefined);
  assert.equal(out[1].attachment_url, `https://cdn/${CONV}/${USER}/a.jpg?t=1`);
  assert.equal(out[2].attachment_url, `https://cdn/${CONV}/${USER}/b.webm?t=1`);
  assert.ok(out[3].attachment_url.includes('download=Collab%20brief.pdf'));
  assert.equal(out[4].attachment_url, undefined);
});

test('withUrls: when signing fails the messages still come back, without links', async () => {
  signingFails = true;
  const out = await messages.withUrls([
    { id: '2', kind: 'image', attachment_path: 'p/a.jpg' },
    { id: '4', kind: 'file', attachment_path: 'p/c.pdf', attachment_name: 'c.pdf' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].attachment_url, null);
  assert.equal(out[1].attachment_url, null);
  assert.deepEqual(await messages.withUrls(null), []);
});

// ── sending, reading, deleting, the poll ────────────────────────────────────

test('send: the attachment and meta go to send_message(); the answer is signed', async () => {
  rpcResults.send_message = (args) => ({
    data: { id: 'm1', kind: args.p_kind, attachment_path: args.p_attachment_path, attachment_name: args.p_attachment_name },
    error: null,
  });
  const { message } = await messages.send('tok', CONV, {
    kind: 'voice', client_id: CLIENT, meta: { duration_ms: 2000 },
    attachment: { path: `${CONV}/${USER}/v.webm`, name: 'voice.webm', type: 'audio/webm', size: 999 },
  });
  const [, name, args] = calls.find((c) => c[0] === 'rpc');
  assert.equal(name, 'send_message');
  assert.deepEqual(args, {
    p_conversation_id: CONV, p_kind: 'voice', p_body: null,
    p_attachment_path: `${CONV}/${USER}/v.webm`, p_attachment_name: 'voice.webm',
    p_attachment_type: 'audio/webm', p_attachment_size: 999,
    p_meta: { duration_ms: 2000 }, p_client_id: CLIENT,
  });
  assert.equal(message.attachment_url, `https://cdn/${CONV}/${USER}/v.webm?t=1`);
});

test('getConversation / markRead: page cursor and read position are whole numbers', async () => {
  rpcResults.get_conversation = { data: { id: CONV, messages: [] }, error: null };
  await messages.getConversation('tok', CONV, { before: 'abc' });
  await messages.getConversation('tok', CONV, { before: '41', limit: '20' });
  const gets = calls.filter((c) => c[1] === 'get_conversation').map((c) => c[2]);
  assert.equal(gets[0].p_before_seq, null);
  assert.equal(gets[1].p_before_seq, 41);
  assert.equal(gets[1].p_limit, 20);

  rpcResults.mark_conversation_read = { data: 41, error: null };
  assert.deepEqual(await messages.markRead('tok', CONV, 41), { last_read_seq: 41 });
});

test('remove: deletes the message, then its file from the bucket', async () => {
  rpcResults.delete_message = { data: { attachment_path: `${CONV}/${USER}/a.jpg` }, error: null };
  await messages.remove('tok', 'm1');
  assert.deepEqual(calls.find((c) => c[0] === 'remove'), ['remove', 'chat', [`${CONV}/${USER}/a.jpg`]]);

  calls.length = 0;
  rpcResults.delete_message = { data: { attachment_path: null }, error: null };
  await messages.remove('tok', 'm2');
  assert.equal(calls.filter((c) => c[0] === 'remove').length, 0);
});

test('updates: cursors are checked; pop-up photos and the open chat\'s files are signed', async () => {
  rpcResults.message_updates = {
    data: {
      latest_seq: 9, unread: 2,
      incoming: [
        { id: 'a', kind: 'text', body: 'hi' },
        { id: 'b', kind: 'image', attachment_path: 'p/photo.jpg' },
        { id: 'c', kind: 'file', attachment_path: 'p/doc.pdf', attachment_name: 'doc.pdf' },
      ],
      conversation: { id: CONV, changes: [{ id: 'd', kind: 'file', attachment_path: 'p/x.pdf', attachment_name: 'x.pdf' }] },
    },
    error: null,
  };
  const result = await messages.updates('tok', { since: '7', conversation: CONV, after: '-3' });
  const args = calls.find((c) => c[1] === 'message_updates')[2];
  assert.deepEqual(args, { p_since: 7, p_conversation_id: CONV, p_after_change: null });
  assert.equal(result.incoming[0].attachment_url, undefined);
  assert.equal(result.incoming[1].attachment_url, 'https://cdn/p/photo.jpg?t=1');
  assert.equal(result.incoming[2].attachment_url, undefined); // documents: only the name in a pop-up
  assert.ok(result.conversation.changes[0].attachment_url.includes('download=x.pdf'));

  await messages.updates('tok', {});
  const second = calls.filter((c) => c[1] === 'message_updates')[1][2];
  assert.deepEqual(second, { p_since: null, p_conversation_id: null, p_after_change: null });
});

test('startConversation: by id, or by username', async () => {
  rpcResults.start_conversation = { data: CONV, error: null };
  assert.deepEqual(await messages.startConversation('tok', { user_id: OTHER }), { conversation_id: CONV });
  assert.deepEqual(await messages.startConversation('tok', { username: 'nino' }), { conversation_id: CONV });
  const starts = calls.filter((c) => c[1] === 'start_conversation').map((c) => c[2]);
  assert.deepEqual(starts, [{ p_other: OTHER }, { p_other: OTHER }]);
});

// ── routes ───────────────────────────────────────────────────────────────────

test('the poll refuses a ?conversation that is not a UUID', () => {
  assert.deepEqual(validateUpdatesQuery({ conversation: 'nope' }), ['Invalid conversation: must be a UUID']);
  assert.deepEqual(validateUpdatesQuery({ conversation: CONV }), []);
  assert.deepEqual(validateUpdatesQuery({}), []);
});

test('routes: everything is behind sign-in', { skip: !router && 'express is not installed' }, () => {
  const paths = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  assert.deepEqual(paths, [
    'GET /updates', 'GET /conversations', 'POST /conversations', 'GET /conversations/:id',
    'POST /conversations/:id/messages', 'POST /conversations/:id/uploads', 'POST /conversations/:id/read',
    'DELETE /messages/:id', 'POST /blocks', 'DELETE /blocks/:userId',
  ]);
  // requireAuth is mounted before every route.
  const firstRoute = router.stack.findIndex((l) => l.route);
  assert.ok(router.stack.slice(0, firstRoute).some((l) => l.name === 'requireAuth'));
});
