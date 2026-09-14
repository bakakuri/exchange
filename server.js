require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "50kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
const publicDir = path.join(__dirname, "public");
const indexPath = path.join(publicDir, "index.html");
const tag = (src, nonce) => `<script src="${src}" nonce="${nonce}"></script>`;

function cspOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.locals.cspNonce = nonce;
  const supabaseOrigin = cspOrigin(supabaseUrl);
  const connect = ["'self'", supabaseOrigin, supabaseOrigin.replace(/^https:/, "wss:")].filter(Boolean).join(" ");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
  next();
});

function renderIndex(res) {
  const nonce = res.locals.cspNonce;
  let html = fs.readFileSync(indexPath, "utf8");
  html = html.replace(/<link rel="preconnect"[^>]*>/g, "");
  html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g, "");
  html = html.replace("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.min.js");
  html = html.replace('<script src="/app.js?v=8" defer></script>', `<script src="/app.js?v=14" nonce="${nonce}"></script><script nonce="${nonce}">window.state=state;</script>`);
  html = html.replace(/<link rel="stylesheet" href="\/typography\.css[^>]*>/g, "");
  html = html.replace(/<link rel="stylesheet" href="\/ui-polish\.css[^>]*>/g, "");
  html = html.replace('<link rel="stylesheet" href="/stage4-product.css?v=1">', '<link rel="stylesheet" href="/stage4-product.css?v=4">');
  html = html.replace(/<link rel="stylesheet" href="\/stage4-product\.css[^>]*>/g, '<link rel="stylesheet" href="/stage4-product.css?v=4">');
  html = html.replace('<link rel="stylesheet" href="/styles.css?v=8">', '<link rel="stylesheet" href="/styles.css?v=14"><link rel="stylesheet" href="/mobile-ui-fix.css?v=2">');
  html = html.replace(/<link rel="stylesheet" href="\/ui-consistency\.css[^>]*>/g, '');
  html = html.replace(/<link rel="stylesheet" href="\/final-mobile-fix\.css[^>]*>/g, '');
  html = html.replace("</body>",
    tag("/feature-lifecycle.js?v=2", nonce) +
    tag("/profile-enhancements.js?v=1", nonce) +
    tag("/campaign-enhancements.js?v=2", nonce) +
    tag("/stage2-enhancements.js?v=3", nonce) +
    tag("/stage4-product.js?v=4", nonce) +
    tag("/production-hardening.js?v=1", nonce) +
    tag("/task-verification.js?v=1", nonce) +
    tag("/promotion-platform-enhancements.js?v=3", nonce) +
    tag("/profile-activity-fix.js?v=1", nonce) +
    tag("/task-card-polish.js?v=1", nonce) +
    '<link rel="stylesheet" href="/ui-consistency.css?v=1"><link rel="stylesheet" href="/final-mobile-fix.css?v=2"><link rel="stylesheet" href="/task-profile-fix.css?v=1"><link rel="stylesheet" href="/auth-modal-fix.css?v=1">' +
    "</body>");
  return html;
}

app.get("/", (_req, res) => {
  try { res.set("Cache-Control", "no-store, max-age=0"); res.type("html").send(renderIndex(res)); }
  catch (error) { console.error("Failed to render index:", error); res.status(500).send("Exchange failed to load."); }
});
app.use(express.static(publicDir, { etag: true }));
app.use("/api", apiLimiter);
app.get("/api/config", (_req, res) => { res.set("Cache-Control", "no-store, max-age=0"); res.json({ supabaseUrl, supabaseAnonKey, configured: Boolean(supabaseUrl && supabaseAnonKey) }); });
app.get("/api/health", (_req, res) => { res.set("Cache-Control", "no-store, max-age=0"); res.json({ ok: true, service: "exchange", supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey), time: new Date().toISOString() }); });
app.get("/api/platforms", (_req, res) => { res.json(["Instagram", "TikTok", "YouTube", "X", "Facebook"]); });
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  try { res.set("Cache-Control", "no-store, max-age=0"); return res.type("html").send(renderIndex(res)); }
  catch (error) { console.error("Failed to render fallback index:", error); return res.status(500).send("Exchange failed to load."); }
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => console.log(`Exchange listening on ${port}`));
}

module.exports = app;
