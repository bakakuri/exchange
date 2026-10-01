// server/server.js
// Express application entry point. Wires together security, parsing,
// static frontend, API routes (mounted stage by stage) and the error
// handler. No business logic lives here.

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const { config } = require('./config/env');
const { applySecurity } = require('./middleware/security');
const { requestId } = require('./middleware/request-id');             // Stage 16
const { requireJson } = require('./middleware/require-json');          // Stage 16
const { requestTimeout } = require('./middleware/request-timeout');    // Stage 19
const { generalLimiter } = require('./middleware/rate-limit');
const { errorHandler } = require('./middleware/error-handler');
const { AppError, ErrorCodes } = require('./utils/errors');
const logger = require('./utils/logger');

const app = express();

// ── Security (must come first) ────────────────────────────────────────────
// applySecurity also sets app.set('trust proxy', 1) so the rate limiter
// sees real client IPs behind Vercel's edge.
applySecurity(app);

// ── Request correlation ───────────────────────────────────────────────────
// Runs before everything so every subsequent log line and error response
// can include req.requestId.
app.use(requestId);

// ── Request timeout ───────────────────────────────────────────────────────
// Arms a per-request timer (default 30 s) that returns 503 if no response
// has been sent when it fires. Must come before the route handlers.
app.use(requestTimeout);

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({ origin: config.appUrl, credentials: true }));

// ── Body parsing ──────────────────────────────────────────────────────────
// 1 MB cap — enough for any realistic JSON payload from this UI; prevents
// memory exhaustion via oversized uploads.
app.use(express.json({ limit: '1mb' }));

// ── Content-Type enforcement ──────────────────────────────────────────────
// POST/PUT/PATCH must send application/json when they carry a body.
// Runs after express.json() so json() doesn't reject the body first with
// a less helpful error.
app.use(requireJson);

// ── Rate limiting ─────────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Static frontend ───────────────────────────────────────────────────────
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ── Health check ──────────────────────────────────────────────────────────
// Returns 200 as long as the process is up. Kubernetes / Vercel / UptimeRobot
// can poll this to detect crashed instances. DB connectivity is checked by
// Supabase's own `/rest/v1/` health endpoint; we don't embed that here to
// keep the health handler free of async failure modes.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    stage: 'stage-19',
    node: process.version,
    uptime: Math.floor(process.uptime()),
  });
});

// ── API routes ────────────────────────────────────────────────────────────
// Mounted stage by stage; each file is self-contained (own auth guards,
// validators, rate limiters). Business logic lives in services, never here.
app.use('/api/auth', require('./routes/auth.routes'));                    // Stage 3
app.use('/api/profile', require('./routes/profile.routes'));              // Stage 4
app.use('/api/social', require('./routes/social.routes'));                // Stage 5
app.use('/api/credits', require('./routes/credits.routes'));              // Stage 6
app.use('/api/tasks', require('./routes/tasks.routes'));                  // Stage 7
app.use('/api/verification', require('./routes/verification.routes'));    // Stage 8
app.use('/api/campaigns', require('./routes/campaigns.routes'));          // Stage 9
app.use('/api/notifications', require('./routes/notifications.routes'));  // Stage 11
app.use('/api/activity', require('./routes/activity.routes'));            // Stage 11
app.use('/api/achievements', require('./routes/achievements.routes'));    // Stage 12
app.use('/api/referrals', require('./routes/referrals.routes'));          // Stage 13
app.use('/api/admin', require('./routes/admin.routes'));                  // Stage 14
app.use('/api/reports', require('./routes/reports.routes'));              // Stage 15

// ── SPA fallback ──────────────────────────────────────────────────────────
// Any non-API GET that isn't a static file gets the app shell, so
// client-side routes survive a hard refresh at a deep link.
app.get(/^(?!\/api).*/, (req, res, next) => {
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) next(err);
  });
});

// ── 404 for unmatched API routes ──────────────────────────────────────────
app.use('/api', (req, res, next) => {
  next(new AppError(ErrorCodes.NOT_FOUND, 'Endpoint not found', 404));
});

app.use(errorHandler);

if (require.main === module) {
  // ── Process-level safety nets ───────────────────────────────────────────
  // Log and exit on fatal errors so the process manager (Vercel / PM2 / k8s)
  // can restart cleanly rather than limping along in a broken state.
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — exiting', {
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection — exiting', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    process.exit(1);
  });

  // ── Start ───────────────────────────────────────────────────────────────
  const server = app.listen(config.port, () => {
    logger.info('Exchange server listening', {
      port: config.port,
      env: process.env.NODE_ENV || 'development',
      node: process.version,
    });
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────
  // SIGTERM is sent by Vercel / Docker / k8s before a forced kill.
  // SIGINT is Ctrl-C in local dev. In both cases:
  //   1. Stop accepting new connections.
  //   2. Wait for in-flight requests to complete (server.close callback).
  //   3. Exit 0 so the process manager doesn't log a crash.
  // A hard-kill timeout (10 s) ensures the process exits even if a stray
  // long-running request refuses to finish.
  function shutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed — exiting');
      process.exit(0);
    });
    // Force-exit if in-flight requests outlast the timeout
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref(); // .unref() so this timer doesn't keep the event loop alive
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

module.exports = app;
