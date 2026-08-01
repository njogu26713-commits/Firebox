const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const db = require('./database');

const app = express();
const PORT = 5000;

// ── In-memory log buffer (last 300 lines) ─────────────────────────────────────
const LOG_BUFFER = [];
const LOG_MAX = 300;
let logSeq = 0;

function pushLog(level, args) {
  const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  LOG_BUFFER.push({ seq: ++logSeq, ts: Date.now(), level, text });
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.shift();
}

const _log   = console.log.bind(console);
const _error = console.error.bind(console);
const _warn  = console.warn.bind(console);
console.log   = (...a) => { pushLog('info',  a); _log(...a); };
console.error = (...a) => { pushLog('error', a); _error(...a); };
console.warn  = (...a) => { pushLog('warn',  a); _warn(...a); };
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

// ── GET /api/qr — fetch a fresh QR code on demand ────────────────────────────

app.get('/api/qr', async (req, res) => {
  try {
    const { sessions, requestPairingCode } = require('./sessionManager');
    const first = [...sessions.values()][0];
    if (!first) return res.status(503).json({ error: 'No session available' });
    if (first.status === 'connected') return res.json({ connected: true });

    // requestPairingCode will restart instance + poll for fresh QR
    await requestPairingCode(first.id, first.number || '');
    const qrImage = first.qr || null;
    if (!qrImage) return res.status(503).json({ error: 'QR not yet available — please retry' });
    res.json({ qrImage });
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

// ── GET /api/logs — return recent log lines (poll with ?since=seq) ───────────

app.get('/api/logs', (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  const lines = LOG_BUFFER.filter(l => l.seq > since);
  res.json({ lines, next: logSeq });
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

// ── GET /api/coins/refill ─────────────────────────────────────────────────────
app.get('/api/coins/refill', (req, res) => {
  res.json(db.getDailyRefill());
});

// ── POST /api/coins/refill ────────────────────────────────────────────────────
app.post('/api/coins/refill', (req, res) => {
  try {
    const { enabled, amount } = req.body;
    const result = db.setDailyRefill(enabled !== false, amount);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ── Hosting plans ─────────────────────────────────────────────────────────────

const PLANS = {
  starter:    { id: 'starter',    name: 'Starter',    price: 100,  hours: 720,  badge: '720 Hours' },
  basic:      { id: 'basic',      name: 'Basic',      price: 250,  hours: 1440, badge: '60 Days'   },
  pro:        { id: 'pro',        name: 'Pro',        price: 500,  hours: 2160, badge: '90 Days'   },
  enterprise: { id: 'enterprise', name: 'Enterprise', price: null, hours: null, badge: 'Custom'    },
};

// ── Licence expiry checker — runs every 5 minutes ────────────────────────────
// Marks active tokens as expired when their expiresAt passes, and suspends the
// associated bot session so the user is forced to renew.

setInterval(() => {
  try {
    const tokens = db.getAllActivationTokens();
    const now    = Date.now();
    for (const t of tokens) {
      if (t.status !== 'active') continue;
      if (!t.expiresAt) continue;
      if (now < new Date(t.expiresAt).getTime()) continue;

      // Licence has expired — mark it and suspend the session
      console.log(`[LICENCE] Token ${t.token} expired — suspending session`);
      db.updateActivationToken(t.token, { status: 'expired' });

      if (t.sessionId) {
        try {
          const { removeSession } = require('./sessionManager');
          removeSession(t.sessionId);
          console.log(`[LICENCE] Suspended session ${t.sessionId} (licence expired)`);
        } catch (e) {
          console.warn(`[LICENCE] Could not remove session ${t.sessionId}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[LICENCE] Expiry check error:', e.message);
  }
}, 5 * 60 * 1000);

// ── POST /api/tokens/verify — check token validity without activating ─────────

app.post('/api/tokens/verify', (req, res) => {
  const raw = (req.body.token || '').trim().toUpperCase();
  if (!raw) return res.status(400).json({ error: 'Activation token is required' });

  const tokenData = db.getActivationToken(raw);
  if (!tokenData) return res.status(400).json({ error: 'Invalid activation token — please check and try again' });

  const now = new Date();

  // If active, check whether the licence has actually expired
  if (tokenData.status === 'active' && tokenData.expiresAt && now > new Date(tokenData.expiresAt)) {
    // Auto-expire it now
    db.updateActivationToken(raw, { status: 'expired' });
    if (tokenData.sessionId) {
      try { const { removeSession } = require('./sessionManager'); removeSession(tokenData.sessionId); } catch (_) {}
    }
    tokenData.status = 'expired';
  }

  // Active and not expired — no payment needed, can generate pairing code directly
  if (tokenData.status === 'active') {
    return res.json({
      valid:        true,
      needsPayment: false,
      status:       'active',
      phone:        tokenData.phone,
      plan:         tokenData.plan,
      expiresAt:    tokenData.expiresAt,
    });
  }

  // Expired licence — payment required to renew
  if (tokenData.status === 'expired') {
    return res.json({
      valid:        true,
      needsPayment: true,
      status:       'expired',
      phone:        tokenData.phone,
      plans:        Object.values(PLANS),
      message:      'Your activation token has expired. Renew your licence to continue using your bot.',
    });
  }

  // Suspended
  if (tokenData.status === 'suspended') {
    return res.json({
      valid:        true,
      needsPayment: true,
      status:       'suspended',
      phone:        tokenData.phone,
      plans:        Object.values(PLANS),
      message:      'Your bot licence has been suspended. Please renew to continue.',
    });
  }

  // Inactive — never been paid, show plans
  return res.json({
    valid:        true,
    needsPayment: true,
    status:       'inactive',
    phone:        tokenData.phone,
    plans:        Object.values(PLANS),
  });
});

// ── POST /api/mpesa/stk-push — initiate M-Pesa STK push ──────────────────────

app.post('/api/mpesa/stk-push', async (req, res) => {
  const { token, planId, mpesaPhone } = req.body;
  if (!token || !planId) return res.status(400).json({ error: 'token and planId are required' });

  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });
  if (!plan.price) return res.status(400).json({ error: 'Contact us to activate an Enterprise plan' });

  const raw = token.trim().toUpperCase();
  const tokenData = db.getActivationToken(raw);
  if (!tokenData) return res.status(400).json({ error: 'Invalid activation token' });
  // Only allow payment for inactive, expired, or suspended tokens (not already-active ones)
  if (tokenData.status === 'active' && tokenData.expiresAt && new Date() < new Date(tokenData.expiresAt)) {
    return res.status(400).json({ error: 'This licence is already active — no payment needed' });
  }

  const payPhone = mpesaPhone ? mpesaPhone.replace(/\D/g, '') : tokenData.phone;

  const hasCredentials = !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET &&
                             process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY);
  const testMode = process.env.MPESA_TEST_MODE === 'true';

  // No credentials configured → auto-confirm immediately (dev / payment-disabled mode)
  if (!hasCredentials && !testMode) {
    const crypto = require('crypto');
    const checkoutId = 'BYPASS-' + crypto.randomUUID().toUpperCase().replace(/-/g, '').slice(0, 16);
    db.createPayment(checkoutId, { token: raw, plan: planId, phone: payPhone, amount: plan.price });
    db.updatePayment(checkoutId, {
      status: 'confirmed',
      mpesaReceiptNumber: 'BYPASS-' + Date.now(),
      resultCode: 0,
      resultDesc: 'Payment bypassed — credentials not yet configured',
    });
    console.log(`[MPESA] Payment bypassed (no credentials) → ${checkoutId}`);
    return res.json({ checkoutRequestId: checkoutId, testMode: true });
  }

  try {
    const mpesa = require('./mpesa');
    const callbackUrl = process.env.MPESA_CALLBACK_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/mpesa/callback` : null);

    const result = await mpesa.stkPush({
      phone:       payPhone,
      amount:      plan.price,
      accountRef:  raw.slice(0, 12),
      description: `Firebox ${plan.name} Plan`,
      callbackUrl: callbackUrl || 'https://placeholder.example.com/callback',
    });

    const checkoutId = result.CheckoutRequestID;
    db.createPayment(checkoutId, { token: raw, plan: planId, phone: payPhone, amount: plan.price });

    // In test mode, auto-confirm after a short delay (simulate payment)
    if (testMode) {
      setTimeout(() => {
        db.updatePayment(checkoutId, {
          status: 'confirmed',
          mpesaReceiptNumber: 'TEST' + Date.now(),
          resultCode: 0,
          resultDesc: 'The service request is processed successfully.',
        });
        console.log(`[MPESA TEST] Auto-confirmed payment ${checkoutId}`);
      }, 4000);
    }

    res.json({ checkoutRequestId: checkoutId, testMode });
  } catch (err) {
    console.error('[MPESA] STK push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/mpesa/callback — receive Daraja payment callback ────────────────

app.post('/api/mpesa/callback', (req, res) => {
  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    const checkoutId = body.CheckoutRequestID;
    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;

    let mpesaReceiptNumber = null;
    if (resultCode === 0 && body.CallbackMetadata?.Item) {
      const item = body.CallbackMetadata.Item.find(i => i.Name === 'MpesaReceiptNumber');
      if (item) mpesaReceiptNumber = item.Value;
    }

    db.updatePayment(checkoutId, {
      status:             resultCode === 0 ? 'confirmed' : 'failed',
      mpesaReceiptNumber: mpesaReceiptNumber,
      resultCode,
      resultDesc,
    });

    console.log(`[MPESA] Callback ${checkoutId} → code=${resultCode} receipt=${mpesaReceiptNumber}`);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('[MPESA] Callback error:', err.message);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// ── GET /api/mpesa/status/:checkoutId — poll payment status ──────────────────

app.get('/api/mpesa/status/:checkoutId', (req, res) => {
  const payment = db.getPayment(req.params.checkoutId);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json({
    status:             payment.status,
    mpesaReceiptNumber: payment.mpesaReceiptNumber,
    resultCode:         payment.resultCode,
    resultDesc:         payment.resultDesc,
  });
});

// ── POST /api/tokens/generate — validate phone & create activation token ──────

app.post('/api/tokens/generate', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length < 7 || cleaned.length > 15) {
    return res.status(400).json({ error: 'Invalid phone number — must be 7 to 15 digits (no spaces, dashes, or +)' });
  }
  try {
    const tokenData = db.createActivationToken(cleaned);
    res.json({ token: tokenData.token, phone: cleaned, createdAt: tokenData.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tokens/activate — activate/renew licence, or reconnect active one ─

app.post('/api/tokens/activate', async (req, res) => {
  const raw        = (req.body.token || '').trim().toUpperCase();
  const planId     = (req.body.planId || '').trim();
  const checkoutId = (req.body.checkoutRequestId || '').trim();

  if (!raw) return res.status(400).json({ error: 'Activation token is required' });

  const tokenData = db.getActivationToken(raw);
  if (!tokenData) return res.status(400).json({ error: 'Invalid activation token' });

  const now = new Date();

  // ── Path A: Token is active and not expired — reconnect (no payment needed) ──
  const isLiveActive =
    tokenData.status === 'active' &&
    tokenData.expiresAt &&
    now < new Date(tokenData.expiresAt);

  if (isLiveActive) {
    // No payment required — just generate a new pairing code for the linked number
    try {
      const { addSession, waitForPairingReady, requestPairingCode, sessions } = require('./sessionManager');

      // Remove any stale session so we can create a fresh one for pairing
      if (tokenData.sessionId) {
        const oldSession = sessions.get(tokenData.sessionId);
        if (oldSession && oldSession.status !== 'connected') {
          try { const { removeSession } = require('./sessionManager'); removeSession(tokenData.sessionId); } catch (_) {}
        } else if (oldSession && oldSession.status === 'connected') {
          return res.status(400).json({ error: 'Bot is already connected. Disconnect first if you want to re-pair.' });
        }
      }

      const session = await addSession('Bot-' + Date.now());
      await waitForPairingReady(session.id);
      const code = await requestPairingCode(session.id, tokenData.phone);

      // Update sessionId on the token so we can suspend it on expiry
      db.updateActivationToken(raw, { sessionId: session.id });

      const plan = PLANS[tokenData.plan] || {};
      const qrImage = sessions.get(session.id)?.qr || null;
      return res.json({
        code,
        qrImage,
        phone:     tokenData.phone,
        sessionId: session.id,
        plan:      { id: plan.id || tokenData.plan, name: plan.name || tokenData.plan, badge: plan.badge || '' },
        expiresAt: tokenData.expiresAt,
        paymentRef: tokenData.paymentRef || null,
        reconnect: true,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Path B: Inactive / expired / suspended — payment required ──────────────
  if (!planId)     return res.status(400).json({ error: 'Plan selection is required' });
  if (!checkoutId) return res.status(400).json({ error: 'Payment reference is required' });

  // Verify payment is confirmed, matches this token, and has not already been consumed
  const payment = db.getPayment(checkoutId);
  if (!payment)                       return res.status(400).json({ error: 'Payment record not found' });
  if (payment.token !== raw)          return res.status(400).json({ error: 'Payment does not match this token' });
  if (payment.status !== 'confirmed') return res.status(400).json({ error: 'Payment not yet confirmed — please wait' });
  if (payment.consumedAt)             return res.status(400).json({ error: 'This payment has already been used to activate a licence' });

  // Always derive the plan from the server-side payment record — never trust the client-supplied planId.
  const resolvedPlanId = payment.plan;
  const plan = PLANS[resolvedPlanId];
  if (!plan)        return res.status(400).json({ error: 'Invalid plan on payment record' });
  if (!plan.price)  return res.status(400).json({ error: 'Enterprise plans cannot be activated through this flow' });
  if (!plan.hours)  return res.status(400).json({ error: 'Plan has no defined runtime — cannot set licence expiry' });

  const runtimeHours = plan.hours || null;
  const expiresAt    = runtimeHours
    ? new Date(Date.now() + runtimeHours * 3600 * 1000).toISOString()
    : null;

  try {
    const { addSession, waitForPairingReady, requestPairingCode, sessions } = require('./sessionManager');

    // Remove old session for this token if present
    if (tokenData.sessionId) {
      try { const { removeSession } = require('./sessionManager'); removeSession(tokenData.sessionId); } catch (_) {}
    }

    const session = await addSession('Bot-' + Date.now());
    await waitForPairingReady(session.id);

    // Generate pairing code for the stored phone — never from user input
    const code = await requestPairingCode(session.id, tokenData.phone);

    // Mark payment as consumed (single-use enforcement) — do this atomically with token update
    db.updatePayment(checkoutId, { consumedAt: now.toISOString() });

    // Persist activation/renewal details on the token
    db.updateActivationToken(raw, {
      status:      'active',
      plan:        resolvedPlanId,
      paymentRef:  payment.mpesaReceiptNumber || checkoutId,
      activatedAt: now.toISOString(),
      expiresAt,
      sessionId:   session.id,
    });

    const qrImage = sessions.get(session.id)?.qr || null;
    res.json({
      code,
      qrImage,
      phone:        tokenData.phone,
      sessionId:    session.id,
      plan:         { id: plan.id, name: plan.name, badge: plan.badge },
      runtimeHours,
      expiresAt,
      paymentRef:   payment.mpesaReceiptNumber || checkoutId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /webhook — kept as a no-op for backward compatibility ───────────────
// (Baileys uses a direct WebSocket connection; webhooks are not needed.)

app.post('/webhook',   (_req, res) => res.sendStatus(200));
app.post('/webhook/*', (_req, res) => res.sendStatus(200));

// ── GET /api/setup-status — updated for Evolution API ────────────────────────

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.get('/', (req, res) => res.redirect('/dashboard'));
// /pair redirects to the new token-based flow
app.get('/pair',      (req, res) => res.redirect('/get-token'));
app.get('/get-token', (req, res) => res.sendFile(path.join(__dirname, '../public/get-token.html')));
app.get('/activate',  (req, res) => res.sendFile(path.join(__dirname, '../public/activate.html')));
app.get('/config',    (req, res) => res.sendFile(path.join(__dirname, '../public/config.html')));
app.get('/admin',     (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/activity',  (req, res) => res.sendFile(path.join(__dirname, '../public/activity.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/dashboard.html')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/get-token.html'));
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
