require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "50kb" }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || "").trim();

app.use(express.static(path.join(__dirname, "public"), { etag: true }));

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.json({
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey)
  });
});

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.json({
    ok: true,
    service: "exchange",
    supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
    time: new Date().toISOString()
  });
});

app.get("/api/platforms", (_req, res) => {
  res.json(["Instagram", "TikTok", "X", "YouTube", "Facebook"]);
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

module.exports = app;
