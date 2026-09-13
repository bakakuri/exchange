require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const platforms = ['Instagram', 'TikTok', 'X', 'YouTube', 'Facebook'];

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'exchange', time: new Date().toISOString() }));
app.get('/api/platforms', (_req, res) => res.json(platforms));

app.get('/api/demo/tasks', (_req, res) => {
  res.json([
    { id: 1, platform: 'Instagram', handle: '@creator_daily', reward: 8, action: 'Follow', category: 'Creator' },
    { id: 2, platform: 'TikTok', handle: '@travelbyte', reward: 12, action: 'Follow', category: 'Travel' },
    { id: 3, platform: 'YouTube', handle: 'Tech Orbit', reward: 15, action: 'Subscribe', category: 'Tech' },
    { id: 4, platform: 'X', handle: '@designpulse', reward: 6, action: 'Follow', category: 'Design' }
  ]);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Exchange running on port ${PORT}`));
