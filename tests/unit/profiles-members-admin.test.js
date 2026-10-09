// tests/unit/profiles-members-admin.test.js
// The API side of 022_profiles_members_admin.sql: profile photo uploads
// (type sniffing, own-folder paths, replacing and removing files), the
// profile fields a member may change, presence throttling, the members
// directory query and response, and the admin tools (profile clean-up,
// campaign actions, messages).

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── a programmable stand-in for supabase-js ──────────────────────────────────

const calls = [];
let rpcResults = {};
let tableRows = {};
let updateResult = null;
let missingColumns = false; // the database doesn't have 022's columns yet

const SUPABASE = 'https://proj.supabase.co';

function fakeQuery(table) {
  const q = {
    select: (fields) => { q.fields = fields; return q; },
    eq: (col, val) => { calls.push(['eq', table, col, val]); return q; },
    in: () => q, lt: () => q, gt: () => q, order: () => q, limit: () => q, ilike: () => q, or: () => q,
    update: (patch) => { calls.push(['update', table, patch]); return q; },
    single: async () => (missingColumns && /cover_url/.test(q.fields || '')
      ? { data: null, error: { code: '42703', message: 'column profiles.cover_url does not exist' } }
      : { data: updateResult || { id: 'u', fields: q.fields }, error: null }),
    maybeSingle: async () => ({ data: (tableRows[table] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: tableRows[table] || [], error: null }),
  };
  return q;
}

function fakeClient() {
  return {
    storage: {
      from: (bucket) => ({
        upload: async (path, body, opts) => { calls.push(['upload', bucket, path, opts.contentType]); return { error: null }; },
        remove: async (paths) => { calls.push(['remove', bucket, paths]); return { error: null }; },
        getPublicUrl: (path) => ({ data: { publicUrl: `${SUPABASE}/storage/v1/object/public/${bucket}/${path}` } }),
        createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://cdn/${p}` })), error: null }),
      }),
    },
    auth: { getUser: async () => ({ data: { user: { id: USER, email: 'giorgi@example.com' } }, error: null }) },
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

const media = require('../../server/services/media.service');
const presence = require('../../server/services/presence.service');
const members = require('../../server/services/members.service');
const admin = require('../../server/services/admin.service');
const { parseDirectoryQuery } = require('../../server/validators/members.validator');
const { validateUpdateProfile, UPDATABLE_FIELDS } = require('../../server/validators/profile.validator');
const { validateAdminProfile, validateCampaignAction, validateAdminMessage } = require('../../server/validators/admin.validator');
const { requireJson } = require('../../server/middleware/require-json');
const { sniffImage } = require('../../server/utils/images');
const PROFILE_FIELDS = require('../../server/constants/profile-fields');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const avatarUrl = (id) => `${SUPABASE}/storage/v1/object/public/media/${USER}/avatar-${id}.webp`;
const OLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  calls.length = 0;
  rpcResults = {};
  tableRows = {};
  updateResult = null;
  missingColumns = false;
});

// ── profile photos ───────────────────────────────────────────────────────────

test('photo upload: stored in the member\'s own folder, profile updated, the old file deleted', async () => {
  tableRows.profiles = [{ avatar_url: avatarUrl(OLD_ID), cover_url: null }];
  await media.uploadPhoto(USER, 'avatar', WEBP, 'image/webp');

  const upload = calls.find((c) => c[0] === 'upload');
  assert.equal(upload[1], 'media');
  assert.match(upload[2], new RegExp(`^${USER}/avatar-[0-9a-f-]{36}\\.webp$`));
  assert.equal(upload[3], 'image/webp');

  const update = calls.find((c) => c[0] === 'update');
  assert.deepEqual(Object.keys(update[2]), ['avatar_url']);
  assert.ok(update[2].avatar_url.endsWith(upload[2]));
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'profiles' && c[2] === 'id' && c[3] === USER));

  assert.deepEqual(calls.find((c) => c[0] === 'remove'), ['remove', 'media', [`${USER}/avatar-${OLD_ID}.webp`]]);
});

test('photo upload: the bytes decide the type, a mismatch or non-image is refused', async () => {
  await assert.rejects(media.uploadPhoto(USER, 'cover', PNG, 'image/webp'), /JPEG, PNG or WebP/);
  await assert.rejects(media.uploadPhoto(USER, 'cover', Buffer.from('<svg/>'), 'image/png'), /JPEG, PNG or WebP/);
  await assert.rejects(media.uploadPhoto(USER, 'cover', Buffer.alloc(0), 'image/png'), /Choose an image/);
  await assert.rejects(media.uploadPhoto(USER, 'banner', PNG, 'image/png'), /Unknown photo kind/);
  assert.ok(!calls.some((c) => c[0] === 'upload'));
});

test('photo removal clears the column and deletes the file; foreign links are never deleted', async () => {
  tableRows.profiles = [{ avatar_url: null, cover_url: `${SUPABASE}/storage/v1/object/public/media/${USER}/cover-${OLD_ID}.jpg` }];
  await media.removePhoto(USER, 'cover');
  assert.deepEqual(calls.find((c) => c[0] === 'update')[2], { cover_url: null });
  assert.deepEqual(calls.find((c) => c[0] === 'remove')[2], [`${USER}/cover-${OLD_ID}.jpg`]);

  const own = `${SUPABASE}/storage/v1/object/public/media/${USER}/cover-${OLD_ID}.jpg`;
  assert.equal(media.pathFromPublicUrl(own, USER), `${USER}/cover-${OLD_ID}.jpg`);
  assert.equal(media.pathFromPublicUrl(own, OTHER), null, 'someone else\'s file is never theirs to delete');
  assert.equal(media.pathFromPublicUrl(own.replace(SUPABASE, 'https://evil.example'), USER), null, 'another host');
  assert.equal(media.pathFromPublicUrl(`https://evil.example/a?${own}`, USER), null);
  assert.equal(media.pathFromPublicUrl(`${SUPABASE}/storage/v1/object/public/media/../../etc/passwd`, USER), null);
  assert.equal(media.pathFromPublicUrl(`${SUPABASE}/storage/v1/object/public/media/%E0%A4%A`, USER), null, 'a broken escape doesn\'t throw');
  assert.equal(media.pathFromPublicUrl(null, USER), null);
});

test('sniffImage moved to utils still recognises the three formats', () => {
  assert.equal(sniffImage(PNG).type, 'image/png');
  assert.equal(sniffImage(WEBP).ext, 'webp');
  assert.equal(sniffImage(Buffer.from('GIF89a')), null);
});

test('photo uploads skip the JSON-only rule; other bodies do not', () => {
  const run = (path, type) => {
    let error;
    requireJson({ method: 'POST', path, headers: { 'content-type': type, 'content-length': '10' } }, {}, (e) => { error = e; });
    return error;
  };
  assert.equal(run('/api/profile/me/avatar', 'image/webp'), undefined);
  assert.equal(run('/api/profile/me/cover', 'image/jpeg'), undefined);
  assert.equal(run('/api/profile/me/avatar', 'text/plain').status, 415);
  assert.equal(run('/api/profile/me', 'image/png').status, 415);
});

// ── profile fields ───────────────────────────────────────────────────────────

test('members change their field and privacy, never photo URLs directly', () => {
  assert.ok(!UPDATABLE_FIELDS.includes('avatar_url'));
  assert.deepEqual(validateUpdateProfile({ category: 'musician', show_online: false }), []);
  assert.deepEqual(validateUpdateProfile({ category: null }), []);
  assert.match(validateUpdateProfile({ category: 'astronaut' }).join(), /Field of work/);
  assert.match(validateUpdateProfile({ show_online: 'no' }).join(), /show_online/);
  assert.match(validateUpdateProfile({ avatar_url: 'https://x.test/a.png' }).join(), /Unsupported field/);
  for (const field of ['cover_url', 'category', 'show_online']) assert.ok(PROFILE_FIELDS.includes(field), field);
});

// ── presence ─────────────────────────────────────────────────────────────────

test('presence is written at most once a minute per member', async () => {
  await presence.touch(USER);
  await presence.touch(USER);
  await presence.touch(OTHER);
  const touches = calls.filter((c) => c[0] === 'rpc' && c[1] === 'touch_presence');
  assert.deepEqual(touches.map((c) => c[2].p_user_id), [USER, OTHER]);
});

test('a failing presence write never fails the request', async () => {
  rpcResults.touch_presence = { data: null, error: { message: 'down' } };
  await presence.touch('33333333-3333-4333-8333-333333333333');
});

// ── members directory ────────────────────────────────────────────────────────

test('directory query: known values pass, unknown ones are refused', () => {
  const ok = parseDirectoryQuery({ search: '  ana ', category: 'gamer', segment: 'online', sort: 'level', offset: '24', limit: '12' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.filters, { search: 'ana', category: 'gamer', segment: 'online', sort: 'level', limit: 12, offset: 24 });
  assert.deepEqual(parseDirectoryQuery({}).filters, { search: null, category: null, segment: null, sort: null, limit: 24, offset: 0 });
  const bad = parseDirectoryQuery({ category: 'astronaut', segment: 'rich', sort: 'random', offset: '-1', limit: '500' });
  assert.equal(bad.errors.length, 5);
});

test('directory list: maps rows, total and the next page', async () => {
  rpcResults.member_directory = {
    data: [
      { id: USER, username: 'ana', is_online: true, last_seen_at: 'now', campaigns_count: 2, completed_count: 5, xp_rank: '1', total_count: '30' },
      { id: OTHER, username: 'beka', is_online: null, last_seen_at: null, campaigns_count: 0, completed_count: 0, xp_rank: '2', total_count: '30' },
    ],
    error: null,
  };
  const result = await members.list('token', { search: null, category: null, segment: 'online', sort: null, limit: 2, offset: 0 });
  assert.equal(result.total, 30);
  assert.equal(result.next_offset, 2);
  assert.equal(result.members[1].is_online, null);
  assert.equal(result.members[0].xp_rank, 1);
  assert.equal(calls.find((c) => c[1] === 'member_directory')[2].p_segment, 'online');

  rpcResults.member_directory = { data: [], error: null };
  const empty = await members.list('token', { limit: 24, offset: 0 });
  assert.deepEqual([empty.total, empty.next_offset, empty.members.length], [0, null, 0]);
});

test('a member that does not exist is a 404', async () => {
  rpcResults.member_directory = { data: [], error: null };
  await assert.rejects(members.getByUsername('token', 'nobody'), (err) => err.status === 404 || err.statusCode === 404 || /not found/i.test(err.message));
});

// ── admin tools ──────────────────────────────────────────────────────────────

test('admin profile edits: validation', () => {
  assert.deepEqual(validateAdminProfile({ remove_avatar: true, reason: 'Offensive picture' }), []);
  assert.deepEqual(validateAdminProfile({ display_name: '', category: '', reason: 'cleanup' }), []);
  assert.match(validateAdminProfile({ reason: 'nothing' }).join(), /Nothing to change/);
  assert.match(validateAdminProfile({ remove_cover: true }).join(), /reason is required/);
  assert.match(validateAdminProfile({ username: 'a b', reason: 'rename' }).join(), /Username/);
  assert.match(validateAdminProfile({ role: 'admin', reason: 'promote' }).join(), /Unsupported/);
  assert.deepEqual(validateCampaignAction({ reason: 'Spam links' }), []);
  assert.match(validateCampaignAction({}).join(), /reason/);
});

test('admin profile clean-up deletes the removed photos - only the member\'s own', async () => {
  rpcResults.admin_update_profile = { data: { removed_avatar_url: avatarUrl(OLD_ID), removed_cover_url: null }, error: null };
  await admin.updateProfile('token', OTHER, { remove_avatar: true, reason: 'Offensive picture' });
  assert.ok(!calls.some((c) => c[0] === 'remove'), 'the avatar sat in another member\'s folder: not deleted');
  calls.length = 0;
  tableRows.profiles = [{ id: USER, username: 'giorgi' }];
  await admin.updateProfile('token', USER, { remove_avatar: true, reason: 'Offensive picture' });
  const rpc = calls.find((c) => c[1] === 'admin_update_profile')[2];
  assert.equal(rpc.p_remove_avatar, true);
  assert.equal(rpc.p_remove_cover, false);
  assert.equal(rpc.p_username, null);
  assert.deepEqual(calls.find((c) => c[0] === 'remove')[2], [`${USER}/avatar-${OLD_ID}.webp`]);
});

test('admin messages: to everyone or one member by username, always said explicitly', async () => {
  assert.deepEqual(validateAdminMessage({ audience: 'everyone', title: 'Hi', body: 'All' }), []);
  assert.deepEqual(validateAdminMessage({ audience: 'member', username: 'beka', title: 'Hi' }), []);
  assert.match(validateAdminMessage({ title: 'Hi' }).join(), /audience/, 'no audience is never a broadcast');
  assert.match(validateAdminMessage({ audience: 'member', title: 'Hi' }).join(), /Username/);
  assert.match(validateAdminMessage({ audience: 'everyone', title: '  ' }).join(), /title is required/);
  assert.match(validateAdminMessage({ audience: 'member', title: 'x', username: 'no spaces' }).join(), /Username/);

  rpcResults.admin_send_message = { data: 42, error: null };
  assert.deepEqual(await admin.sendMessage('token', { audience: 'everyone', title: 'Hi', body: 'All' }), { sent: 42 });
  assert.equal(calls.find((c) => c[1] === 'admin_send_message')[2].p_user_id, null);

  calls.length = 0;
  tableRows.profiles = [{ id: OTHER }];
  rpcResults.admin_send_message = { data: 1, error: null };
  await admin.sendMessage('token', { audience: 'member', username: 'beka', title: 'Hi' });
  assert.equal(calls.find((c) => c[1] === 'admin_send_message')[2].p_user_id, OTHER);

  tableRows.profiles = [];
  await assert.rejects(admin.sendMessage('token', { audience: 'member', username: 'ghost', title: 'Hi' }), /No member/);
});

test('admin campaign actions go through admin_campaign_action with the reason', async () => {
  rpcResults.admin_campaign_action = { data: null, error: { message: 'CAMPAIGN_CANCELLED: campaign cannot be cancelled from its current state' } };
  await assert.rejects(admin.campaignAction('token', 'c1', 'cancel', 'spam'), (err) => err.code === 'CAMPAIGN_CANCELLED');
  rpcResults.admin_campaign_action = { data: null, error: null };
  calls.length = 0;
  tableRows.campaigns = [{ id: 'c1', creator_id: USER, status: 'paused', task: [{ platform: 'x' }] }];
  const campaign = await admin.campaignAction('token', 'c1', 'pause', 'Checking reports');
  assert.equal(campaign.task.platform, 'x');
  assert.deepEqual(calls.find((c) => c[1] === 'admin_campaign_action')[2], { p_campaign_id: 'c1', p_action: 'pause', p_reason: 'Checking reports' });
});

test('admin searches treat %, _ and \\ literally', () => {
  assert.equal(admin.likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
  assert.equal(admin.likePattern('   '), null);
});

test('signing in keeps working when the code is deployed before migration 022', async () => {
  const auth = require('../../server/services/auth.service');
  missingColumns = true;
  const user = await auth.getUserFromToken('token');
  assert.equal(user.email, 'giorgi@example.com');
  assert.ok(!/cover_url/.test(user.fields));
  missingColumns = false;
  assert.match((await auth.getUserFromToken('token')).fields, /cover_url/);
});
