// server/utils/logger.js
// Leveled logger with two output modes:
//
//   development  — human-readable text to stdout/stderr with a timestamp
//                  prefix, so local `node server/server.js` is pleasant.
//
//   production   — one JSON object per line to stdout, so Vercel's log
//                  aggregator (and any SIEM / log-shipper) can parse
//                  structured fields without regexes.
//
//                  Format: {"level":"info","time":"<ISO-8601>","msg":"...",
//                           "requestId":"<uuid>", ...meta}
//
// Every other module depends on this interface, not on console directly,
// so switching output format (or swapping in pino/winston) is one-file work.

'use strict';

const { isProduction } = require('../config/env');

function timestamp() {
  return new Date().toISOString();
}

// ── JSON line formatter (production) ─────────────────────────────────────────
function jsonLine(level, msg, meta) {
  const entry = { level, time: timestamp(), msg };
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    Object.assign(entry, meta);
  } else if (meta !== undefined && meta !== null && meta !== '') {
    entry.meta = meta;
  }
  return JSON.stringify(entry);
}

// ── Text formatter (development) ─────────────────────────────────────────────
function textLine(label, msg, meta) {
  const ts = timestamp();
  const base = `[${ts}] ${label}  ${msg}`;
  if (meta !== undefined && meta !== null && meta !== '') {
    // Pretty-print objects; keep primitives inline
    const extra =
      typeof meta === 'object' ? JSON.stringify(meta) : String(meta);
    return `${base} ${extra}`;
  }
  return base;
}

// ── Public API ────────────────────────────────────────────────────────────────
const logger = {
  info(msg, meta) {
    if (isProduction) {
      process.stdout.write(jsonLine('info', msg, meta) + '\n');
    } else {
      console.log(textLine('INFO ', msg, meta));
    }
  },

  warn(msg, meta) {
    if (isProduction) {
      process.stdout.write(jsonLine('warn', msg, meta) + '\n');
    } else {
      console.warn(textLine('WARN ', msg, meta));
    }
  },

  error(msg, meta) {
    if (isProduction) {
      // Errors go to stdout too — Vercel merges stderr into the same stream
      // but keeping everything on stdout guarantees ordering in log viewers.
      process.stdout.write(jsonLine('error', msg, meta) + '\n');
    } else {
      console.error(textLine('ERROR', msg, meta));
    }
  },
};

module.exports = logger;
