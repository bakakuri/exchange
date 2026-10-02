// tests/unit/config.test.js
// Deployment-config guards for the problems found after the first Vercel
// deploy: the public/ bundling that blanked every page, and APP_URL
// silently defaulting to localhost in production.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

// ── vercel.json ───────────────────────────────────────────────────────────────

test('vercel.json: public/ is served by the CDN, never bundled into a function', () => {
  assert.equal(vercel.outputDirectory, 'public');
  assert.equal(vercel.builds, undefined, 'legacy "builds" would bundle and transpile public/ JS');
  assert.ok(!JSON.stringify(vercel).includes('includeFiles'));
  assert.equal(vercel.functions?.['api/index.js']?.excludeFiles, 'public/**');
});

test('vercel.json: /api/* is rewritten to the api/index.js function', () => {
  const apiRewrite = vercel.rewrites.find((r) => r.source.startsWith('/api/'));
  assert.ok(apiRewrite, 'missing /api rewrite');
  assert.equal(apiRewrite.destination, '/api');
  assert.ok(fs.existsSync(path.join(ROOT, 'api', 'index.js')));
});

test('vercel.json: SPA fallback comes after the API rewrite and skips file paths', () => {
  const apiIdx = vercel.rewrites.findIndex((r) => r.source.startsWith('/api/'));
  const spaIdx = vercel.rewrites.findIndex((r) => r.destination === '/index.html');
  assert.ok(spaIdx > apiIdx, 'SPA rewrite must not shadow /api');
  const spa = new RegExp(`^${vercel.rewrites[spaIdx].source}$`);
  assert.ok(spa.test('/tasks'));
  assert.ok(spa.test('/u/nino'));
  assert.ok(!spa.test('/api/health'));
  assert.ok(!spa.test('/js/core/missing.js'), 'missing assets should 404, not get HTML');
});

test('vercel.json: static responses carry the CSP and Permissions-Policy headers', () => {
  const keys = vercel.headers.flatMap((h) => h.headers.map((x) => x.key.toLowerCase()));
  for (const k of ['content-security-policy', 'permissions-policy', 'x-content-type-options', 'strict-transport-security']) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
});

// ── .env.example must stay a template ─────────────────────────────────────────

test('.env.example: Supabase keys are blank and no key-shaped value is present', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const line = example.split('\n').find((l) => l.startsWith(`${key}=`));
    assert.ok(line, `${key} missing from .env.example`);
    assert.equal(line.slice(key.length + 1).trim(), '', `${key} must be empty in .env.example - real values go in .env / Vercel`);
  }
  assert.ok(!/eyJ[\w-]{10,}\.[\w-]{10,}\./.test(example), 'a JWT-shaped key is committed in .env.example');
  assert.ok(!/sb_(secret|publishable)_[\w-]{8,}/.test(example), 'an sb_ API key is committed in .env.example');
});

// ── env.js appUrl resolution ──────────────────────────────────────────────────

function appUrlWith(env) {
  const script = "console.warn = () => {}; process.stdout.write(require('./server/config/env').config.appUrl)";
  return execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ...env },
  }).toString();
}

test('appUrl: APP_URL wins and loses its trailing slash', () => {
  assert.equal(appUrlWith({ APP_URL: 'https://example.com/', VERCEL_URL: 'x.vercel.app' }), 'https://example.com');
});

test('appUrl: falls back to the Vercel production URL in production', () => {
  assert.equal(
    appUrlWith({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'exchange.vercel.app', VERCEL_URL: 'exchange-abc.vercel.app' }),
    'https://exchange.vercel.app'
  );
});

test('appUrl: previews use the deployment URL; local defaults to localhost', () => {
  assert.equal(appUrlWith({ VERCEL_ENV: 'preview', VERCEL_URL: 'exchange-abc.vercel.app' }), 'https://exchange-abc.vercel.app');
  assert.equal(appUrlWith({}), 'http://localhost:3000');
});
