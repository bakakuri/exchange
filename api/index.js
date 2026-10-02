// api/index.js
// Vercel entry point. Every /api/* request is rewritten here (vercel.json)
// and handled by the full Express app - Vercel keeps the original URL in
// req.url, so the app's /api/... routes match unchanged.
//
// Static files (public/**) are NOT served through this function: Vercel's
// CDN serves them directly. The old setup bundled them into the function
// (legacy builds + includeFiles) and served those copies; the Node builder
// transpiles bundled .js to CommonJS, which broke the browser's ES modules
// (the blank-page bug this layout fixes). server.js still references
// public/ for local express.static, so vercel.json excludes public/** from
// this function's bundle explicitly.
//
// Locally nothing changes: `npm start` runs server/server.js, which also
// serves public/ via express.static.

'use strict';

module.exports = require('../server/server');
