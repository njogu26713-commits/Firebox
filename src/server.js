const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const db = require('./database');

const app = express();
const PORT = 5000;
const SESSION_BASE = path.join(__dirname, '../session');

app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, '../public'), { etag: false, lastModified: false }));

// ── helper: build per-session JSON ───────────────────────────────────────────

async function sessionToJSON(s) {
  const uptime = Math.floor((Date.now() - s.startTime) / 1000);
  let qrImage = null;
  if (s.qr) {
    try {
      qrImage = await QRCode.toDataURL(s.qr, {
        width: 240, margin: 2,
        color: { dark: '#ffffff', light: '#1a1a1a' }
      });
    } catch {}
  }
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    number: s.number,
    qrImage,
    pairingCode: s.pairingCode,
    messageCount: s.messageCount,
    commandCount: s.commandCount,
    uptime: {
      hours:   Math.floor(uptime / 3600),
      minutes: Math.floor((uptime % 3600) / 60),
      seconds: uptime % 60,
      total:   uptime
    }
  };
}

// ── GET /api/sessions ─────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  const { sessions } = require('./sessionManager');
  const list = await Promise.all([...sessions.values()].map(sessionToJSON));
  res.json({ sessions: list });
});

// ── POST /api/sessions — create a new session ────────────────────────────────

app.post('/api/sessions', async (req, res) => {
  try {
    const { addSession } = require('./sessionManager');
    const { name } = req.body;
    const s = await addSession(name);
    res.json(await sessionToJSON(s));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/sessions/:id ──────────────────────────────────────────────────

app.delete('/api/sessions/:id', (req, res) => {
  try {
    const { removeSession } = require('./sessionManager');
    removeSession(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/sessions/:id/pairing ────────────────────────────────────────────

app.post('/api/sessions/:id/pairing', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Phone number is required' });
  try {
    const { requestPairingCode } = require('./sessionManager');
    const code = await requestPairingCode(req.params.id, number);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── legacy single-session status (backward compat) ───────────────────────────

app.get('/api/status', async (req, res) => {
  const { sessions } = require('./sessionManager');
  const first = [...sessions.values()][0];
  if (!first) return res.json({ status: 'disconnected', number: null, messageCount: 0, commandCount: 0 });
  const groups = db.getAllGroups();
  const uptime = Math.floor((Date.now() - first.startTime) / 1000);
  let qrImage = null;
  if (first.qr) {
    try { qrImage = await QRCode.toDataURL(first.qr, { width: 280, margin: 2, color: { dark: '#ffffff', light: '#1a1a1a' } }); } catch {}
  }
  res.json({
    status: first.status, number: first.number,
    uptime: { hours: Math.floor(uptime/3600), minutes: Math.floor((uptime%3600)/60), seconds: uptime%60, total: uptime },
    messageCount: first.messageCount, commandCount: first.commandCount,
    groupCount: groups.length, groups,
    recentActivity: first.recentActivity.slice(0, 20),
    prefix: process.env.PREFIX || '.', version: '1.0.0',
    qrImage, pairingCode: first.pairingCode
  });
});

app.post('/api/connect/pairing', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Phone number is required' });
  try {
    const { sessions, requestPairingCode } = require('./sessionManager');
    const first = [...sessions.values()][0];
    if (!first) return res.status(503).json({ error: 'No session available' });
    const code = await requestPairingCode(first.id, number);
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/setup-status ─────────────────────────────────────────────────────

app.get('/api/setup-status', (req, res) => {
  let hasDiskSession = false;
  if (fs.existsSync(SESSION_BASE)) {
    for (const entry of fs.readdirSync(SESSION_BASE)) {
      if (fs.existsSync(path.join(SESSION_BASE, entry, 'creds.json'))) {
        hasDiskSession = true;
        break;
      }
    }
  }

  res.json({ setupRequired: !hasDiskSession });
});

// ── GET /api/config — read .env config vars ───────────────────────────────────

const ENV_FILE = path.join(__dirname, '../.env');
const EXPOSED_VARS = ['OWNER_NUMBER', 'OWNER_NAME', 'PREFIX', 'BOT_NAME'];

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  const vars = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    vars[key] = val;
  }
  return vars;
}

function writeEnvFile(vars) {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf8');
}

app.get('/api/config', (req, res) => {
  const vars = readEnvFile();
  const result = {};
  for (const key of EXPOSED_VARS) {
    const val = vars[key] || '';
    result[key] = { value: val, masked: null };
  }
  res.json(result);
});

// ── POST /api/config — save config vars and apply ────────────────────────────

app.post('/api/config', async (req, res) => {
  try {
    const updates = req.body; // { SESSION_ID: '...', OWNER_NUMBER: '...', ... }
    const vars = readEnvFile();

    for (const key of EXPOSED_VARS) {
      if (updates[key] !== undefined) {
        if (updates[key] === '') {
          delete vars[key];
        } else {
          vars[key] = updates[key];
        }
      }
    }

    writeEnvFile(vars);

    // Reload env into current process
    for (const [k, v] of Object.entries(vars)) {
      process.env[k] = v;
    }

    res.json({ success: true, message: 'Config saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/sessions/:id/export — export session as base64 string ────────────

app.get('/api/sessions/:id/export', (req, res) => {
  try {
    const sessionDir = path.join(SESSION_BASE, req.params.id);
    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const files = fs.readdirSync(sessionDir);
    const bundle = {};
    for (const file of files) {
      const filePath = path.join(sessionDir, file);
      if (fs.statSync(filePath).isFile()) {
        bundle[file] = fs.readFileSync(filePath, 'utf8');
      }
    }
    const encoded = Buffer.from(JSON.stringify(bundle)).toString('base64');
    res.json({ sessionId: encoded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/coins ────────────────────────────────────────────────────────────
app.get('/api/coins', (req, res) => {
  const data = db.getCoins();
  res.json(data);
});

// ── POST /api/coins/add — add coins ───────────────────────────────────────────
app.post('/api/coins/add', (req, res) => {
  try {
    const { amount, note } = req.body;
    const amt = parseInt(amount);
    if (!amt || amt <= 0 || amt > 1000000) return res.status(400).json({ error: 'Invalid amount (1–1000000)' });
    const newBalance = db.addCoins(amt, note || 'Dashboard top-up');
    res.json({ success: true, balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/coins/set — set coins ───────────────────────────────────────────
app.post('/api/coins/set', (req, res) => {
  try {
    const { amount } = req.body;
    const amt = parseInt(amount);
    if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Invalid amount' });
    const newBalance = db.setCoins(amt);
    res.json({ success: true, balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/activity — activity across all sessions ─────────────────────────
app.get('/api/activity', (req, res) => {
  const { sessions } = require('./sessionManager');
  const all = [];
  for (const s of sessions.values()) {
    for (const entry of (s.recentActivity || [])) {
      all.push({ sessionId: s.id, sessionName: s.name, number: s.number, status: s.status, ...entry });
    }
  }
  all.sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json({ activity: all.slice(0, 200) });
});

// ── GET /api/sessions/:id/activity — activity for one session ─────────────────
app.get('/api/sessions/:id/activity', (req, res) => {
  const { sessions } = require('./sessionManager');
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({ sessionId: s.id, sessionName: s.name, number: s.number, status: s.status, activity: s.recentActivity || [] });
});

app.get('/', (req, res) => res.redirect('/pair'));
app.get('/pair',     (req, res) => res.sendFile(path.join(__dirname, '../public/pair.html')));
app.get('/config',   (req, res) => res.sendFile(path.join(__dirname, '../public/config.html')));
app.get('/admin',    (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/activity',  (req, res) => res.sendFile(path.join(__dirname, '../public/activity.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/dashboard.html')));

app.use((req, res) => {
  res.redirect('/pair');
});

function startServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Dashboard running on port ${PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[SERVER] Port ${PORT} in use, waiting 3s then retrying...`);
      server.close();
      setTimeout(() => startServer(), 3000);
    } else {
      console.error('[SERVER] Error:', err.message);
    }
  });
}

module.exports = { startServer };
