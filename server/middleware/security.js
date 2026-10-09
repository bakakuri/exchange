// server/middleware/security.js
// Security headers and CSP. The frontend is plain HTML/CSS/JS served
// statically, so the policy stays tight: no framework CDNs to allow-list.
// Also sets trust proxy so Express sees the real client IP when running
// behind Vercel's edge (needed for accurate rate-limit bucketing).

const helmet = require('helmet');
const { config } = require('../config/env');

// Chat files (023) are uploaded from the browser straight to Supabase
// Storage and played from there, so the page may connect to it and play
// media from https: (and blob: - a voice message before it is sent).
function supabaseOrigin() {
  try {
    return new URL(config.supabaseUrl).origin;
  } catch {
    return 'https://*.supabase.co';
  }
}

function applySecurity(app) {
  // Trust the first hop (Vercel's edge proxy / any reverse proxy).
  // Without this, all requests appear to come from the proxy IP and
  // rate limiting would bucket everyone together.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Content-Security-Policy: tight for a plain HTML/JS frontend.
      // 'unsafe-inline' on styleSrc is needed because we use inline style
      // attributes in a few dynamic elements; scripts are always files.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          // Allow XHR/fetch to own origin only. No third-party API calls
          // from the browser - everything external goes through our server.
          connectSrc: ["'self'", supabaseOrigin()],
          mediaSrc: ["'self'", 'https:', 'blob:', 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },

      // HSTS: 1 year, include subdomains, allow preload registration.
      // Harmless in dev (sent but browsers only enforce it on HTTPS
      // origins); critical in production.
      strictTransportSecurity: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },

      // Disable COEP: we don't use SharedArrayBuffer or cross-origin
      // isolation, and enabling it would require every static asset to
      // send CORP headers, which is unnecessary overhead for this stack.
      crossOriginEmbedderPolicy: false,
    })
  );

  // Permissions-Policy: disable browser features the app never uses.
  // Helmet has no option for this header (an unknown `permissionsPolicy`
  // key is silently ignored), so it is set here directly. Full-screen stays
  // allowed for our own origin (future video content, negligible risk).
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  });
}

// The microphone is allowed for this site only: voice messages (023).
const PERMISSIONS_POLICY =
  'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), fullscreen=(self)';

module.exports = { applySecurity, PERMISSIONS_POLICY };
