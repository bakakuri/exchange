// tests/integration/server.helper.js
// Builds a MINIMAL node:http server wiring up only the pure middleware
// (request-id, require-json, validate-uuid-param, errors) that have zero
// npm dependencies.  This lets integration tests verify end-to-end HTTP
// behaviour without requiring the npm packages that aren't installed in
// the local dev environment.
//
// Routes registered by registerRoute() are trivially thin:
//   GET  /api/health          → 200 { status:'ok', stage:'stage-15' }
//   POST /api/auth/register   → 200 {}   (after middlewares pass)
//   GET  /api/auth/session    → 200 {}   (simulated protected route)
//
// requireAuth is simulated: routes marked requireAuth:true return 401 when
// the Authorization header is absent (the real guard does the same check
// synchronously before calling Supabase).

'use strict';

const http = require('node:http');
const { requestId } = require('../../server/middleware/request-id');
const { requireJson } = require('../../server/middleware/require-json');
const { validateUuidParam } = require('../../server/middleware/validate-uuid-param');
const { AppError, ErrorCodes } = require('../../server/utils/errors');

// ── Tiny router ───────────────────────────────────────────────────────────────

const routes = [];

function registerRoute(method, path, middlewares, handler) {
  routes.push({ method: method.toUpperCase(), path, middlewares, handler });
}

function buildRouter(req, res, done) {
  for (const route of routes) {
    if (route.method !== req.method) continue;

    // Simple path matching: literals and :param segments
    const routeParts = route.path.split('/');
    const reqParts = req.url.split('?')[0].split('/');
    if (routeParts.length !== reqParts.length) continue;

    const params = {};
    let match = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = decodeURIComponent(reqParts[i]);
      } else if (routeParts[i] !== reqParts[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    req.params = params;
    const stack = [...route.middlewares, route.handler];
    let idx = 0;
    function next(err) {
      if (err) return done(err);
      const fn = stack[idx++];
      if (!fn) return done(new AppError(ErrorCodes.NOT_FOUND, 'Not found', 404));
      try { fn(req, res, next); } catch (e) { done(e); }
    }
    return next();
  }
  done(new AppError(ErrorCodes.NOT_FOUND, 'Endpoint not found', 404));
}

// ── Auth simulation ───────────────────────────────────────────────────────────

function requireAuthStub(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Sign in required', 401));
  }
  next();
}

// ── Request body parsing ──────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        req.body = data ? JSON.parse(data) : undefined;
        resolve();
      } catch (_) {
        req.body = undefined;
        resolve();
      }
    });
    req.on('error', reject);
  });
}

// ── Send helpers ──────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

// ── Build the test app server ─────────────────────────────────────────────────

function buildApp() {
  // Global middleware applied to every request (in order):
  const globalMiddleware = [requestId, requireJson];

  // ── Routes ───────────────────────────────────────────────────────────────
  registerRoute('GET', '/api/health', [], (req, res) => {
    sendJson(res, 200, { status: 'ok', stage: 'stage-15' });
  });

  // Public POST (no auth required) — exercises requireJson gate
  registerRoute('POST', '/api/auth/register', [], (req, res, next) => {
    // Minimal validator: password required
    const body = req.body || {};
    if (!body.email || !body.password) {
      return next(new AppError(ErrorCodes.VALIDATION_ERROR,
        'Password must be at least 8 characters', 400));
    }
    sendJson(res, 200, {});
  });

  // Protected GET — exercises auth gate
  registerRoute('GET', '/api/auth/session',  [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('POST', '/api/auth/logout',  [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/profile/me',    [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/credits/balance',[requireAuthStub],(req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/tasks',         [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/campaigns/mine',[requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/notifications', [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/achievements',  [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/referrals',     [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/reports/mine',  [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/admin/stats',   [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/admin/users',   [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET', '/api/admin/reports', [requireAuthStub], (req, res) => { sendJson(res, 200, {}); });

  // UUID-param routes — UUID validation runs AFTER auth in the real app,
  // but here we place it first to test it directly at HTTP level.
  registerRoute('GET',   '/api/campaigns/:id',
    [validateUuidParam('id'), requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('PATCH', '/api/social/:id',
    [validateUuidParam('id'), requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('GET',   '/api/admin/users/:id',
    [validateUuidParam('id'), requireAuthStub], (req, res) => { sendJson(res, 200, {}); });
  registerRoute('PATCH', '/api/notifications/:id/read',
    [validateUuidParam('id'), requireAuthStub], (req, res) => { sendJson(res, 200, {}); });

  // ── Core request handler ──────────────────────────────────────────────────
  return http.createServer(async (req, res) => {
    // 1. Parse body so middleware can inspect Content-Length / Transfer-Encoding
    await parseBody(req).catch(() => {});

    // 2. Run global middleware
    let mwIdx = 0;
    function runGlobal(err) {
      if (err) return handleError(err, req, res);
      if (mwIdx >= globalMiddleware.length) {
        // 3. Route dispatch
        return buildRouter(req, res, (routeErr) => handleError(routeErr, req, res));
      }
      const mw = globalMiddleware[mwIdx++];
      try { mw(req, res, runGlobal); } catch (e) { handleError(e, req, res); }
    }
    runGlobal();
  });
}

function handleError(err, req, res) {
  if (res.headersSent) return;
  const requestId = req.requestId || null;
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message }, requestId });
  } else {
    sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' }, requestId });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function startServer() {
  const server = buildApp();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const close = () => new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return { baseUrl, close };
}

async function get(baseUrl, path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, headers: res.headers, body: json };
}

async function post(baseUrl, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, headers: res.headers, body: json };
}

async function patch(baseUrl, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, headers: res.headers, body: json };
}

module.exports = { startServer, get, post, patch };
