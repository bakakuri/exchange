// tests/unit/auth-service.test.js
// Auth service behaviour with a stubbed @supabase/supabase-js (no npm
// install needed): per-call auth clients, and which sign-ups are allowed
// to touch a profile.

'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// ── Stub supabase-js before anything requires it ─────────────────────────────

const calls = [];
let signUpResult;
let created = 0;

function fakeClient() {
  created += 1;
  return {
    auth: {
      signUp: async (args) => { calls.push(['signUp', args]); return signUpResult; },
      admin: {
        updateUserById: async (id, attrs) => { calls.push(['updateUserById', id, attrs]); return { error: null }; },
        signOut: async (jwt, scope) => { calls.push(['signOut', jwt, scope]); return { error: null }; },
      },
    },
    from: (table) => ({
      update: (values) => ({
        eq: async (col, id) => { calls.push(['update', table, values, id]); return { error: null }; },
      }),
      select: () => ({ eq: () => ({ single: async () => ({ data: { username: 'x' }, error: null }) }) }),
    }),
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { error: null }; },
  };
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') return { createClient: fakeClient };
  return originalLoad.call(this, request, ...rest);
};

const { createAuthClient } = require('../../server/config/supabase');
const supabaseConfig = require('../../server/config/supabase');
const authService = require('../../server/services/auth.service');

const now = () => new Date().toISOString();
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => { calls.length = 0; });

// ── Per-call auth clients ─────────────────────────────────────────────────────

test('createAuthClient returns a fresh client every call (no shared session state)', () => {
  const before = created;
  const a = createAuthClient();
  const b = createAuthClient();
  assert.notEqual(a, b);
  assert.equal(created - before, 2);
  assert.equal(supabaseConfig.supabaseAnon, undefined, 'a shared anon auth client must not be exported');
});

// ── register(): who may have their profile touched ────────────────────────────

test('register: brand-new account gets the chosen username', async () => {
  signUpResult = { data: { user: { id: 'u-new', identities: [{}], created_at: now() }, session: null }, error: null };
  await authService.register({ email: 'a@b.co', password: 'password1', username: 'giorgi' });
  const update = calls.find((c) => c[0] === 'update');
  assert.deepEqual(update, ['update', 'profiles', { username: 'giorgi' }, 'u-new']);
});

test('register: existing UNCONFIRMED account (real user, old created_at) is not renamed', async () => {
  signUpResult = { data: { user: { id: 'u-old', identities: [{}], created_at: dayAgo() }, session: null }, error: null };
  await authService.register({ email: 'a@b.co', password: 'password1', username: 'hijack' });
  assert.equal(calls.find((c) => c[0] === 'update'), undefined);
});

test('register: already-confirmed email (obfuscated user, no identities) is not touched', async () => {
  signUpResult = { data: { user: { id: 'random', identities: [], created_at: now() }, session: null }, error: null };
  await authService.register({ email: 'a@b.co', password: 'password1', username: 'hijack' });
  assert.equal(calls.find((c) => c[0] === 'update'), undefined);
});

test('register: referral code is uppercased and parked in metadata when there is no session', async () => {
  signUpResult = { data: { user: { id: 'u-new', identities: [{}], created_at: now() }, session: null }, error: null };
  await authService.register({ email: 'a@b.co', password: 'password1', referral_code: ' abcd1234 ' });
  const [, args] = calls.find((c) => c[0] === 'signUp');
  assert.equal(args.options.data.pending_referral_code, 'ABCD1234');
  assert.match(args.options.emailRedirectTo, /\/login$/);
  assert.equal(calls.find((c) => c[0] === 'rpc'), undefined, 'cannot claim without a session');
});

test('logout revokes every session of the token via the admin API', async () => {
  await authService.logout('user-jwt');
  assert.deepEqual(calls.find((c) => c[0] === 'signOut'), ['signOut', 'user-jwt', 'global']);
});
