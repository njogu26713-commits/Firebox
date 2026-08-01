/**
 * Session Manager — native Baileys edition
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the Evolution API adapter with a direct @whiskeysockets/baileys
 * WebSocket connection. The public interface (sessions, addSession,
 * removeSession, requestPairingCode, waitForPairingReady, loadAndStartAll) is
 * preserved so the rest of the codebase doesn't need to change.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const pino = require('pino');

const { createSessionState, addActivity } = require('./state');
const db = require('./database');

// ── Config ────────────────────────────────────────────────────────────────────

const PREFIX        = process.env.PREFIX || '.';
const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');
const SESSION_BASE  = path.join(__dirname, '../session');

// Singleton session map — one entry per connected WhatsApp number
const sessions = new Map();

// Global dedup cache to prevent double-processing
const _handledMsgIds = new Map();
const DEDUP_TTL = 60 * 1000;

// ── Baileys (ESM) — loaded once via dynamic import ────────────────────────────

let Baileys = null;
async function getBaileys() {
  if (!Baileys) {
    Baileys = await import('@whiskeysockets/baileys');
  }
  return Baileys;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function loadSessionList() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch { return []; }
}

function saveSessionList() {
  const list = [...sessions.values()].map(s => ({
    id: s.id, name: s.name, createdAt: s.createdAt,
  }));
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2)); } catch {}
}

// ── Start / restart a Baileys socket for one session ─────────────────────────

async function startBaileysSession(id, name, createdAt) {
  const B = await getBaileys();

  // makeWASocket may be default or named export depending on build
  const makeWASocket = B.default || B.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, Browsers, downloadMediaMessage } = B;

  // Create or reuse in-memory session state
  let sessionState = sessions.get(id);
  if (!sessionState) {
    sessionState = createSessionState(id, name || `Session ${sessions.size + 1}`);
    sessionState.createdAt = createdAt || Date.now();
    sessionState.awayMode  = db.getBotSetting('awayMode') || false;
    sessionState.awayMsg   = db.getBotSetting('awayMsg')  || sessionState.awayMsg;
    sessions.set(id, sessionState);
  }

  sessionState.status = 'connecting';

  // Auth state stored on disk so sessions survive restarts
  const sessionDir = path.join(SESSION_BASE, id);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    auth:                state,
    logger,
    printQRInTerminal:   false,   // We surface QR via the dashboard, not terminal
    browser:             Browsers.baileys('Desktop'),
    syncFullHistory:     false,
    markOnlineOnConnect: true,
    connectTimeoutMs:    60000,
    retryRequestDelayMs: 2000,
    getMessage: async (key) => {
      const cached = sessionState.messageCache?.get(key.id);
      return cached || { conversation: '' };
    },
  });

  // ── Attach downloadMediaMessage as a sock method (matches previous interface) ─
  // Returns a Buffer directly (commands that used for-await loops have been updated).
  sock.downloadMediaMessage = async (msg) => {
    try {
      return await downloadMediaMessage(msg, 'buffer', {});
    } catch (err) {
      console.error('[BAILEYS] downloadMediaMessage error:', err.message);
      return null;
    }
  };

  sessionState.sock = sock;

  // ── connection.update ─────────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sessionState.qr           = qr;
      sessionState.pairingCode  = null;
      sessionState.status        = 'connecting';
      console.log(`[BAILEYS] QR updated for session '${id}'`);
    }

    if (connection === 'open') {
      sessionState.status       = 'connected';
      sessionState.qr           = null;
      sessionState.pairingCode  = null;
      sessionState.number        = sock.user?.id?.split(':')[0] || null;
      console.log(`[BAILEYS] Session '${id}' connected — +${sessionState.number}`);
    }

    if (connection === 'close') {
      const statusCode   = lastDisconnect?.error?.output?.statusCode;
      const loggedOutCode = DisconnectReason?.loggedOut || 401;
      const shouldReconnect = statusCode !== loggedOutCode;

      console.log(`[BAILEYS] Session '${id}' closed — code=${statusCode} reconnect=${shouldReconnect}`);
      sessionState.status = 'disconnected';
      sessionState.number = null;

      if (shouldReconnect && !sessionState._removed) {
        console.log(`[BAILEYS] Reconnecting session '${id}' in 5 s...`);
        setTimeout(() => {
          if (sessionState._removed) return;
          startBaileysSession(id, sessionState.name, sessionState.createdAt).catch(console.error);
        }, 5000);
      } else if (!shouldReconnect) {
        // Logged out — wipe auth state so next start shows a fresh QR
        console.log(`[BAILEYS] Session '${id}' logged out — clearing auth state`);
        try { fs.rmSync(path.join(SESSION_BASE, id), { recursive: true, force: true }); } catch {}
      }
    }
  });

  // ── credentials saved ─────────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── incoming messages ─────────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify') return;

    for (const msg of msgs) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;

      // Dedup
      const msgId = msg.key.id;
      if (msgId) {
        if (_handledMsgIds.has(msgId)) continue;
        _handledMsgIds.set(msgId, Date.now());
        setTimeout(() => _handledMsgIds.delete(msgId), DEDUP_TTL);
      }

      sessionState.messageCount++;

      try {
        const { handleMessage } = require('./handler');
        await handleMessage(sock, msg, PREFIX, sessionState);
      } catch (err) {
        console.error(`[BAILEYS] handleMessage error:`, err.message);
      }
    }
  });

  // ── messages deleted (anti-delete) ────────────────────────────────────────────
  sock.ev.on('messages.delete', async (item) => {
    const ownerNumber = process.env.OWNER_NUMBER;
    if (!ownerNumber) return;
    const ownerJid = ownerNumber + '@s.whatsapp.net';

    const keys = item.keys || [];
    for (const key of keys) {
      const cached = sessionState.messageCache?.get(key.id);
      if (!cached || !db.getBotSetting('antiDelete')) continue;
      sessionState.messageCache.delete(key.id);
      const { body, mType, sender, from, mediaBuffer } = cached;
      const senderTag = sender ? sender.split('@')[0] : 'unknown';
      const isGroup   = from?.endsWith('@g.us');
      const chatLabel = isGroup ? `group ${from?.split('@')[0]}` : `DM with ${senderTag}`;
      const header    = `✖ *Deleted Message*\n[USER] *By:* @${senderTag}\n» *Chat:* ${chatLabel}\n\n`;
      try {
        if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'].includes(mType) && mediaBuffer) {
          const mediaSendPayload =
            mType === 'imageMessage'   ? { image: mediaBuffer, caption: header + (body || '[Image]') } :
            mType === 'videoMessage'   ? { video: mediaBuffer, mimetype: 'video/mp4', caption: header + (body || '[Video]') } :
            mType === 'audioMessage'   ? { audio: mediaBuffer, mimetype: 'audio/mp4', ptt: false } :
            mType === 'stickerMessage' ? { sticker: mediaBuffer } : null;
          if (mediaSendPayload) await sock.sendMessage(ownerJid, mediaSendPayload);
        } else if (body) {
          await sock.sendMessage(ownerJid, {
            text: header + `► *Message:*\n${body}`,
            mentions: sender ? [sender] : [],
          });
        }
      } catch (err) {
        console.error('[BAILEYS] anti-delete forward error:', err.message);
      }
    }
  });

  // ── group participants update ─────────────────────────────────────────────────
  sock.ev.on('group-participants.update', async (data) => {
    try {
      const { handleGroupParticipantUpdate } = require('./commands/group');
      await handleGroupParticipantUpdate(sock, data);
    } catch (err) {
      console.error('[BAILEYS] Group participant update error:', err.message);
    }
  });

  // ── call events ───────────────────────────────────────────────────────────────
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status !== 'offer') continue;
      const callerJid = call.from || call.chatId;
      const isDM = callerJid?.endsWith('@s.whatsapp.net');
      if (!isDM) continue;
      if (!db.getBotSetting('anticallDm')) continue;
      const customMsg   = db.getBotSetting('antiCallMsg');
      const channelLink = db.getBotSetting('channelLink');
      const channelSuffix = channelLink ? `\n\n» *Follow our channel:* ${channelLink}` : '';
      const text = customMsg ||
        `▲ *Call Blocked!*\n\n[NO-MOB] This bot does not accept calls.\n` +
        `» Please send a text message instead.${channelSuffix}\n\n_Powered by ★ Firebox_`;
      try { await sock.sendMessage(callerJid, { text }); } catch (_) {}
    }
  });

  // ── scheduler: send due scheduled messages every 30 s ─────────────────────────
  if (!sessionState._schedulerInterval) {
    sessionState._schedulerInterval = setInterval(async () => {
      db.checkAndApplyDailyRefill();
      if (sessionState.status !== 'connected') return;
      const now = Date.now();
      const due = db.getSchedules().filter(s => s.jid && s.sendAt <= now);
      for (const s of due) {
        try {
          await sock.sendMessage(s.jid, { text: `[SCHED] *Scheduled Message*\n\n${s.message}` });
          db.removeSchedule(s.id);
        } catch (_) { db.removeSchedule(s.id); }
      }
    }, 30000);
  }

  console.log(`[BAILEYS] Session '${id}' initialising...`);
  return sessionState;
}

// ── Public API — preserves original interface ──────────────────────────────────

async function addSession(name) {
  const id = 'sess_' + Date.now();
  const sessionState = await startBaileysSession(id, name || `Session ${sessions.size + 1}`);
  saveSessionList();
  return sessionState;
}

function removeSession(id) {
  const s = sessions.get(id);
  if (s) {
    s._removed = true;
    if (s._schedulerInterval) clearInterval(s._schedulerInterval);
    try { s.sock?.end?.(); } catch {}
  }
  sessions.delete(id);
  saveSessionList();
}

/**
 * requestPairingCode — request a WhatsApp pairing code for the given phone
 * number (called BEFORE the QR code event fires). If number is empty the
 * dashboard will fall back to displaying the QR code instead.
 */
async function requestPairingCode(id, number) {
  const s0 = sessions.get(id);
  if (!s0) throw new Error('Session not found');

  const clean = String(number || '').replace(/[^0-9]/g, '');

  if (!clean) {
    // No phone number supplied — QR flow
    s0._socketInitialized = true;
    return null;
  }

  // Give the WS handshake a moment to complete before the first attempt
  await new Promise(r => setTimeout(r, 1000));

  // Retry up to 3 times — Baileys occasionally closes the WS before the
  // pairing-code response arrives (transient network blip on cloud hosts).
  const MAX_ATTEMPTS = 3;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Always fetch the current state + sock — retries may have swapped the socket
    const sessionState = sessions.get(id);
    if (!sessionState) throw new Error('Session not found');

    const sock = sessionState.sock;
    if (!sock) throw new Error('Socket not ready — please retry');

    try {
      const code = await sock.requestPairingCode(clean);
      const formatted = code.match(/.{1,4}/g)?.join('-') || code;
      sessionState.pairingCode        = formatted;
      sessionState._socketInitialized = true;
      return formatted;
    } catch (err) {
      lastErr = err;
      const isConnectionErr = /connection closed|connection lost|timed out|econnreset/i.test(err.message || '');
      console.warn(`[BAILEYS] requestPairingCode attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err.message);
      if (!isConnectionErr || attempt === MAX_ATTEMPTS) break;

      // Back-off then spin up a fresh socket so the next attempt has a clean WS
      await new Promise(r => setTimeout(r, 2500 * attempt));
      try {
        await startBaileysSession(id, sessionState.name, sessionState.createdAt);
        // Give the new socket ~1.5 s to complete the WS handshake with WhatsApp
        await new Promise(r => setTimeout(r, 1500));
      } catch (_) {}
    }
  }

  throw lastErr;
}

async function waitForPairingReady(id, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = sessions.get(id);
    if (!s)                        throw new Error('Session not found');
    if (s.status === 'connected')  throw new Error('Session is already connected');
    if (s.sock) {
      s._socketInitialized = true;
      return s;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Timed out waiting for Baileys session to initialise');
}

function isSetupRequired() {
  if (sessions.size > 0) return false;
  if (!fs.existsSync(SESSION_BASE)) return true;
  for (const entry of fs.readdirSync(SESSION_BASE)) {
    if (fs.existsSync(path.join(SESSION_BASE, entry, 'creds.json'))) return false;
  }
  return true;
}

async function loadAndStartAll() {
  fs.mkdirSync(path.join(__dirname, '../data'),  { recursive: true });
  fs.mkdirSync(SESSION_BASE, { recursive: true });

  const saved = loadSessionList();

  // Re-start any sessions that have saved credentials
  if (fs.existsSync(SESSION_BASE)) {
    for (const entry of fs.readdirSync(SESSION_BASE)) {
      const credsFile = path.join(SESSION_BASE, entry, 'creds.json');
      if (!fs.existsSync(credsFile)) continue;
      const meta = saved.find(s => s.id === entry) || {
        id: entry, name: `Session ${entry.slice(-4)}`, createdAt: Date.now(),
      };
      console.log(`[BAILEYS] Restoring session '${entry}'...`);
      await startBaileysSession(meta.id, meta.name, meta.createdAt);
    }
  }

  // No existing sessions → start a fresh one (will display QR on dashboard)
  if (sessions.size === 0) {
    console.log('[BAILEYS] No saved sessions — starting fresh session (scan QR or use pairing code)...');
    await startBaileysSession('sess_default', 'Firebox Bot', Date.now());
  }

  saveSessionList();
}

module.exports = {
  sessions,
  addSession,
  startSession: startBaileysSession,
  removeSession,
  requestPairingCode,
  waitForPairingReady,
  loadAndStartAll,
  isSetupRequired,
};
