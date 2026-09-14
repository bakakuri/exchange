require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "50kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
const publicDir = path.join(__dirname, "public");
const indexPath = path.join(publicDir, "index.html");
const tag=(src)=>'<scr'+'ipt src="'+src+'"></scr'+'ipt>';

function renderIndex() {
  let html = fs.readFileSync(indexPath, "utf8");
  html = html.replace(/<link rel="preconnect"[^>]*>/g, "");
  html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g, "");
  html = html.replace("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.0/dist/umd/supabase.min.js");
  html = html.replace('<script src="/app.js?v=8" defer></script>', '<script src="/mobile-menu-compat.js?v=1"></script><script src="/app.js?v=12"></script>');
  html = html.replace('<script src="/app.js?v=12"></script>', '<script src="/mobile-menu-compat.js?v=1"></script><script src="/app.js?v=12"></script>');
  html = html.replace(/<link rel="stylesheet" href="\/typography\.css[^>]*>/g, "");
  html = html.replace(/<link rel="stylesheet" href="\/ui-polish\.css[^>]*>/g, "");
  html = html.replace('<link rel="stylesheet" href="/stage4-product.css?v=1">', '<link rel="stylesheet" href="/stage4-product.css?v=4">');
  html = html.replace(/<link rel="stylesheet" href="\/stage4-product\.css[^>]*>/g, '<link rel="stylesheet" href="/stage4-product.css?v=4">');
  html = html.replace('<link rel="stylesheet" href="/styles.css?v=8">', '<link rel="stylesheet" href="/styles.css?v=12"><link rel="stylesheet" href="/mobile-ui-fix.css?v=2">');
  html = html.replace(/<link rel="stylesheet" href="\/ui-consistency\.css[^>]*>/g, '');
  html = html.replace("</body>", tag("/profile-enhancements.js?v=1") + tag("/campaign-enhancements.js?v=2") + tag("/stage2-enhancements.js?v=3") + tag("/stage4-product.js?v=4") + tag("/production-hardening.js?v=1") + tag("/task-verification.js?v=1") + tag("/promotion-platform-enhancements.js?v=3") + tag("/stability-fix.js?v=1") + '<link rel="stylesheet" href="/ui-consistency.css?v=1">' + "</body>");
  return html;
}

app.get("/", (_req, res) => {
  try { res.set("Cache-Control", "no-store, max-age=0"); res.type("html").send(renderIndex()); }
  catch (error) { console.error("Failed to render index:", error); res.status(500).send("Exchange failed to load."); }
});
app.use(express.static(publicDir, { etag: true }));
app.get("/api/config", (_req, res) => { res.set("Cache-Control", "no-store, max-age=0"); res.json({ supabaseUrl, supabaseAnonKey, configured: Boolean(supabaseUrl && supabaseAnonKey) }); });
app.get("/api/health", (_req, res) => { res.set("Cache-Control", "no-store, max-age=0"); res.json({ ok: true, service: "exchange", supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey), time: new Date().toISOString() }); });
app.get("/api/platforms", (_req, res) => { res.json(["Instagram", "TikTok", "YouTube", "X", "Facebook"]); });
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  try { res.set("Cache-Control", "no-store, max-age=0"); return res.type("html").send(renderIndex()); }
  catch (error) { console.error("Failed to render fallback index:", error); return res.status(500).send("Exchange failed to load."); }
});
module.exports = app;
