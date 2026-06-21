const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const db = require('./database');
const { execSync } = require('child_process');

const app = express();
const PORT = 5000;
const SESSION_BASE = path.join(__dirname, '../session');

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
  const raw = process.env.SESSION_ID;
  const hasEnvSession = !!(raw && raw.trim());

  let hasDiskSession = false;
  if (fs.existsSync(SESSION_BASE)) {
    for (const entry of fs.readdirSync(SESSION_BASE)) {
      if (fs.existsSync(path.join(SESSION_BASE, entry, 'creds.json'))) {
        hasDiskSession = true;
        break;
      }
    }
  }

  res.json({ setupRequired: !hasEnvSession && !hasDiskSession });
});

// ── GET /api/config — read .env config vars ───────────────────────────────────

const ENV_FILE = path.join(__dirname, '../.env');
const EXPOSED_VARS = ['SESSION_ID', 'OWNER_NUMBER', 'OWNER_NAME', 'PREFIX', 'BOT_NAME'];

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
    let val = vars[key] || '';
    if (key === 'SESSION_ID' && val.length > 40) {
      result[key] = { value: val, masked: val.slice(0, 20) + '...' + val.slice(-10) };
    } else {
      result[key] = { value: val, masked: null };
    }
  }
  res.json(result);
});

// ── Universal Session ID parser — supports all common bot formats ─────────────

function parseSessionId(raw) {
  const AdmZip = require('adm-zip');

  // ── Format 1: CYPHER-X  (CYPHER-X:~<base64zip> with * replacing +) ──────────
  if (raw.startsWith('CYPHER-X:~') || raw.startsWith('CYPHER-X: ~')) {
    const b64 = raw.replace(/^CYPHER-X:\s*~/, '').replace(/\*/g, '+');
    const buf = Buffer.from(b64, 'base64');
    if (buf[0] === 0x50 && buf[1] === 0x4B) { // ZIP magic PK
      const zip = new AdmZip(buf);
      const bundle = {};
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory) {
          bundle[entry.entryName] = entry.getData().toString('utf8');
        }
      }
      return bundle;
    }
  }

  // ── Format 2: Raw ZIP base64 (PK magic after decode) ─────────────────────────
  try {
    const buf = Buffer.from(raw.replace(/\*/g, '+'), 'base64');
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
      const zip = new AdmZip(buf);
      const bundle = {};
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory) {
          bundle[entry.entryName] = entry.getData().toString('utf8');
        }
      }
      if (bundle['creds.json']) return bundle;
    }
  } catch (_) {}

  // ── Format 3: My JSON-bundle base64 ({filename: content, ...}) ───────────────
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object' && parsed['creds.json']) {
      return parsed;
    }
  } catch (_) {}

  // ── Format 4: Raw creds.json base64 (Baileys creds object directly) ──────────
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const creds = JSON.parse(decoded);
    if (creds && (creds.noiseKey || creds.signedIdentityKey || creds.registrationId)) {
      return { 'creds.json': decoded };
    }
  } catch (_) {}

  // ── Format 5: Plain JSON string (not base64 encoded) ─────────────────────────
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed['creds.json']) return parsed;
    if (parsed && (parsed.noiseKey || parsed.signedIdentityKey)) {
      return { 'creds.json': raw };
    }
  } catch (_) {}

  throw new Error(
    'Unrecognised Session ID format. Make sure you copied the full Session ID ' +
    'that your bot sent to your WhatsApp. Supported formats: Firebox, CYPHER-X, ZIP, and Baileys JSON.'
  );
}

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

    // If SESSION_ID was updated, apply it immediately
    const newSessionId = updates['SESSION_ID'];
    if (newSessionId && newSessionId.trim()) {
      let bundle;
      try {
        bundle = parseSessionId(newSessionId.trim());
      } catch (parseErr) {
        return res.status(400).json({ error: parseErr.message });
      }

      if (!bundle['creds.json']) {
        return res.status(400).json({ error: 'Invalid SESSION_ID — could not find credentials inside. Make sure you copied the full Session ID.' });
      }

      const { sessions, startSession } = require('./sessionManager');
      const id = 'sess_env';
      const sessionDir = path.join(SESSION_BASE, id);

      // Stop existing sess_env if running
      const existing = sessions.get(id);
      if (existing?.sock) { try { existing.sock.end(new Error('reconfigured')); } catch {} sessions.delete(id); }

      fs.mkdirSync(sessionDir, { recursive: true });
      // Clear old files
      for (const f of fs.readdirSync(sessionDir)) {
        fs.rmSync(path.join(sessionDir, f), { force: true });
      }
      // Write new session files
      for (const [file, content] of Object.entries(bundle)) {
        fs.writeFileSync(path.join(sessionDir, file), content, 'utf8');
      }

      const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');
      fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([{ id, name: 'Bot', createdAt: Date.now() }], null, 2));

      await startSession(id, 'Bot', Date.now());
      return res.json({ success: true, message: 'Config saved. Bot is connecting with new session...' });
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

// ── POST /api/sessions/import — restore session from base64 string ────────────

app.post('/api/sessions/import', async (req, res) => {
  try {
    const { sessionId, name } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    let bundle;
    try {
      bundle = parseSessionId(sessionId.trim());
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }

    if (!bundle['creds.json']) {
      return res.status(400).json({ error: 'Invalid session ID: missing credentials' });
    }

    const id = 'sess_' + Date.now();
    const sessionDir = path.join(SESSION_BASE, id);
    fs.mkdirSync(sessionDir, { recursive: true });

    for (const [file, content] of Object.entries(bundle)) {
      fs.writeFileSync(path.join(sessionDir, file), content, 'utf8');
    }

    const { startSession, sessions } = require('./sessionManager');
    const { saveSessionList } = require('./sessionManager');
    const sessionName = name || 'Imported Bot';
    const createdAt = Date.now();

    await startSession(id, sessionName, createdAt);

    const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');
    let list = [];
    try { list = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch {}
    list.push({ id, name: sessionName, createdAt });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.redirect('/pair'));
app.get('/pair',   (req, res) => res.sendFile(path.join(__dirname, '../public/pair.html')));
app.get('/config', (req, res) => res.sendFile(path.join(__dirname, '../public/config.html')));

app.use((req, res) => {
  res.redirect('/pair');
});

function startServer() {
  // Kill anything on the port before binding
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`); } catch {}
  try { execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`); } catch {}

  setTimeout(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[SERVER] Dashboard running on port ${PORT}`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[SERVER] Port ${PORT} busy, retrying in 2s...`);
        setTimeout(() => startServer(), 2000);
      } else {
        console.error('[SERVER] Error:', err.message);
      }
    });
  }, 500);
}

module.exports = { startServer };
