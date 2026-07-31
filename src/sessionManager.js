/**
 * Session Manager — Evolution API edition
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the Baileys-based session manager with an Evolution API adapter.
 * The public interface (sessions, addSession, removeSession, requestPairingCode,
 * waitForPairingReady, loadAndStartAll) is preserved so the rest of the codebase
 * doesn't need to change.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

const {
  createSockAdapter,
  createEvoClient,
  ensureInstance,
  getInstanceState,
  getInstanceNumber,
  setupWebhook,
  getQrCode,
} = require('./evolutionApi');

const { createSessionState, addActivity } = require('./state');
const db = require('./database');

// ── Config ────────────────────────────────────────────────────────────────────

const EVO_API_URL  = process.env.EVOLUTION_API_URL  || '';
const EVO_API_KEY  = process.env.EVOLUTION_API_KEY  || '';
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || 'firebox-bot';
const PREFIX       = process.env.PREFIX || '.';

const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');

// Singleton session map — one entry per Evolution API instance
const sessions = new Map();

// Global dedup cache
const _handledMsgIds = new Map();
const DEDUP_TTL = 60 * 1000;

// ── persistence helpers ────────────────────────────────────────────────────────

function loadSessionList() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch { return []; }
}

function saveSessionList() {
  const list = [...sessions.values()].map(s => ({
    id: s.id, name: s.name, createdAt: s.createdAt
  }));
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2)); } catch {}
}

// ── build / update the sessionState for the single Evolution API instance ─────

async function startEvoSession(id, name, createdAt) {
  if (!EVO_API_URL || !EVO_API_KEY) {
    console.error('[EVO] EVOLUTION_API_URL / EVOLUTION_API_KEY not set — cannot start.');
    return null;
  }

  let sessionState = sessions.get(id);
  if (!sessionState) {
    sessionState = createSessionState(id, name || EVO_INSTANCE);
    sessionState.createdAt = createdAt || Date.now();
    sessionState.awayMode  = db.getBotSetting('awayMode')  || false;
    sessionState.awayMsg   = db.getBotSetting('awayMsg')   || sessionState.awayMsg;
    sessions.set(id, sessionState);
  }

  sessionState.status = 'connecting';

  const client = createEvoClient(EVO_API_URL, EVO_API_KEY);

  // ── Ensure the instance exists on the Evolution API server ───────────────
  await ensureInstance(EVO_API_URL, EVO_API_KEY, EVO_INSTANCE);

  // ── Set up webhook so Evolution API pushes events to us ──────────────────
  const webhookUrl = buildWebhookUrl();
  if (webhookUrl) {
    await setupWebhook(client, EVO_INSTANCE, webhookUrl);
  } else {
    console.warn('[EVO] WEBHOOK_URL not set — incoming messages will not arrive. Set WEBHOOK_URL env var.');
  }

  // ── Check current connection state ───────────────────────────────────────
  await refreshSessionState(sessionState, client);

  // ── Attach sock adapter ──────────────────────────────────────────────────
  const userNumber = await getInstanceNumber(client, EVO_INSTANCE);
  const sock = createSockAdapter(EVO_INSTANCE, EVO_API_URL, EVO_API_KEY, userNumber);
  sessionState.sock   = sock;
  sessionState.number = userNumber;

  // ── Start scheduler ──────────────────────────────────────────────────────
  if (!sessionState._schedulerInterval) {
    sessionState._schedulerInterval = setInterval(async () => {
      db.checkAndApplyDailyRefill();
      if (sessionState.status !== 'connected') return;
      const now = Date.now();
      const due = db.getSchedules().filter(s => s.jid && s.sendAt <= now);
      for (const s of due) {
        try {
          await sock.sendMessage(s.jid, {
            text: `[SCHED] *Scheduled Message*\n\n${s.message}`
          });
          db.removeSchedule(s.id);
        } catch (_) {
          db.removeSchedule(s.id);
        }
      }
    }, 30000);
  }

  // ── Poll Evolution API every 15s to sync connection state ────────────────
  if (!sessionState._pollInterval) {
    sessionState._pollInterval = setInterval(async () => {
      if (sessionState._removed) return;
      await refreshSessionState(sessionState, client);

      // Update sock user if number was just resolved
      if (!sessionState.sock.user && sessionState.number) {
        sessionState.sock = createSockAdapter(
          EVO_INSTANCE, EVO_API_URL, EVO_API_KEY, sessionState.number
        );
      }
    }, 15000);
  }

  console.log(`[EVO] Session '${id}' initialised — status: ${sessionState.status}`);
  return sessionState;
}

async function refreshSessionState(sessionState, client) {
  const rawState = await getInstanceState(client, EVO_INSTANCE);
  const prevStatus = sessionState.status;

  if (rawState === 'open') {
    sessionState.status = 'connected';
    sessionState.qr = null;
    sessionState.pairingCode = null;
    if (!sessionState.number) {
      sessionState.number = await getInstanceNumber(client, EVO_INSTANCE);
    }
    if (prevStatus !== 'connected') {
      console.log(`[EVO] Instance '${EVO_INSTANCE}' connected — ${sessionState.number}`);
    }
  } else if (rawState === 'connecting') {
    sessionState.status = 'connecting';
  } else {
    // close / unknown — try to fetch QR
    sessionState.status = 'disconnected';
    try {
      const qr = await getQrCode(client, EVO_INSTANCE);
      if (qr) sessionState.qr = qr;
    } catch (_) {}
  }
}

function buildWebhookUrl() {
  if (process.env.WEBHOOK_URL) return process.env.WEBHOOK_URL;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`;
  }
  if (process.env.RAILWAY_STATIC_URL) {
    return `${process.env.RAILWAY_STATIC_URL}/webhook`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/webhook`;
  }
  return null;
}

// ── public API — preserves original interface ─────────────────────────────────

async function addSession(name) {
  const id = 'sess_' + Date.now();
  const sessionState = await startEvoSession(id, name || `Session ${sessions.size + 1}`);
  saveSessionList();
  return sessionState;
}

function removeSession(id) {
  const s = sessions.get(id);
  if (s) {
    s._removed = true;
    if (s._schedulerInterval) clearInterval(s._schedulerInterval);
    if (s._pollInterval)      clearInterval(s._pollInterval);
  }
  sessions.delete(id);
  saveSessionList();
}

async function requestPairingCode(id, number) {
  if (!EVO_API_URL || !EVO_API_KEY) throw new Error('Evolution API not configured');
  const client = createEvoClient(EVO_API_URL, EVO_API_KEY);
  const clean = String(number).replace(/[^0-9]/g, '');

  try {
    const { data } = await client.post(`/instance/connect/${EVO_INSTANCE}`);
    // If Evolution API returns a pairing code directly
    if (data?.code) {
      const formatted = data.code.match(/.{1,4}/g)?.join('-') || data.code;
      const s = sessions.get(id);
      if (s) { s.pairingCode = formatted; s._socketInitialized = true; }
      return formatted;
    }
  } catch (_) {}

  // Try pairing code endpoint
  try {
    const { data } = await client.post(`/instance/pairingCode/${EVO_INSTANCE}`, {
      phoneNumber: clean,
    });
    const code = data?.code || data?.pairingCode;
    if (code) {
      const formatted = code.match(/.{1,4}/g)?.join('-') || code;
      const s = sessions.get(id);
      if (s) { s.pairingCode = formatted; s._socketInitialized = true; }
      return formatted;
    }
  } catch (e) {
    console.warn('[EVO] requestPairingCode failed:', e?.response?.data || e.message);
  }

  // Pairing code not supported by this Evolution API version — fall back to QR code
  try {
    const { data } = await client.get(`/instance/connect/${EVO_INSTANCE}`);
    const qr = data?.base64 || data?.qrcode?.base64 || data?.qrcode;
    if (qr) {
      const s = sessions.get(id);
      if (s) { s.qr = qr; s._socketInitialized = true; }
      console.log('[EVO] Pairing code unavailable — falling back to QR code.');
      return null; // caller checks session.qr
    }
  } catch (e) {
    console.error('[EVO] QR fallback failed:', e?.response?.data || e.message);
  }

  throw new Error('Could not obtain pairing code or QR code from Evolution API. Ensure the instance is in connecting state.');
}

async function waitForPairingReady(id, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (s.status === 'connected') throw new Error('Session is already connected');
    // For Evolution API, we're ready as soon as the session is created
    s._socketInitialized = true;
    return s;
  }
  throw new Error('Timed out waiting for Evolution API session');
}

function isSetupRequired() {
  // With Evolution API, setup is required only if API URL is not configured
  return !EVO_API_URL || !EVO_API_KEY;
}

async function loadAndStartAll() {
  if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  }

  if (isSetupRequired()) {
    console.log('[EVO] ▲  EVOLUTION_API_URL / EVOLUTION_API_KEY not set. Configure in environment variables.');
    return;
  }

  // Always start a single session mapped to the configured Evolution API instance
  const id = 'sess_evo_' + EVO_INSTANCE.replace(/[^a-z0-9]/gi, '_');

  console.log(`[EVO] Starting session for instance '${EVO_INSTANCE}'...`);
  await startEvoSession(id, EVO_INSTANCE, Date.now());
  saveSessionList();
}

// ── Incoming webhook handler (called from server.js) ─────────────────────────

async function handleWebhookEvent(event, instanceName, data) {
  // Route to the right session
  const sessionState = [...sessions.values()].find(s =>
    s.name === instanceName || s.id.includes(instanceName.replace(/[^a-z0-9]/gi, '_'))
  ) || [...sessions.values()][0];

  if (!sessionState) {
    console.warn(`[EVO] No session found for webhook instance '${instanceName}'`);
    return;
  }

  if (!sessionState.sock) {
    const userNumber = sessionState.number;
    sessionState.sock = createSockAdapter(EVO_INSTANCE, EVO_API_URL, EVO_API_KEY, userNumber);
  }

  const sock = sessionState.sock;

  switch (event) {
    case 'connection.update':
    case 'CONNECTION_UPDATE': {
      const state = data?.state || data?.connection;
      if (state === 'open') {
        sessionState.status = 'connected';
        sessionState.qr = null;
        sessionState.pairingCode = null;
        if (data?.instance?.ownerJid) {
          sessionState.number = data.instance.ownerJid.split('@')[0].split(':')[0];
          sessionState.sock = createSockAdapter(EVO_INSTANCE, EVO_API_URL, EVO_API_KEY, sessionState.number);
        }
        console.log(`[EVO] Connected! +${sessionState.number}`);
      } else if (state === 'close' || state === 'refused') {
        sessionState.status = 'disconnected';
        sessionState.number = null;
        console.log(`[EVO] Disconnected.`);
      } else if (state === 'connecting') {
        sessionState.status = 'connecting';
      }
      break;
    }

    case 'qrcode.updated':
    case 'QRCODE_UPDATED': {
      const qr = data?.qrcode?.base64 || data?.base64 || data?.qrcode;
      if (qr) {
        sessionState.qr = qr;
        sessionState.pairingCode = null;
        console.log('[EVO] QR code updated.');
      }
      break;
    }

    case 'messages.upsert':
    case 'MESSAGES_UPSERT': {
      const { handleMessage } = require('./handler');
      const messages = Array.isArray(data) ? data : (data?.messages || [data]);

      for (const msg of messages) {
        if (!msg?.message && !msg?.messageType) continue;

        // Normalize message format to Baileys-compatible structure
        const normalizedMsg = normalizeMessage(msg);
        if (!normalizedMsg) continue;

        // Skip our own sent messages (fromMe)
        if (normalizedMsg.key.fromMe) continue;

        // Dedup
        const msgId = normalizedMsg.key.id;
        if (msgId) {
          if (_handledMsgIds.has(msgId)) continue;
          _handledMsgIds.set(msgId, Date.now());
          setTimeout(() => _handledMsgIds.delete(msgId), DEDUP_TTL);
        }

        sessionState.messageCount++;

        try {
          await handleMessage(sock, normalizedMsg, PREFIX, sessionState);
        } catch (err) {
          console.error(`[EVO] handleMessage error:`, err.message);
        }
      }
      break;
    }

    case 'messages.delete':
    case 'MESSAGES_DELETE': {
      // Anti-delete: forward deleted messages to owner
      const ownerNumber = process.env.OWNER_NUMBER;
      if (!ownerNumber) break;
      const ownerJid = ownerNumber + '@s.whatsapp.net';
      const keys = Array.isArray(data) ? data : (data?.keys || []);
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
          console.error('[EVO] anti-delete forward error:', err.message);
        }
      }
      break;
    }

    case 'group-participants.update':
    case 'GROUP_PARTICIPANTS_UPDATE': {
      const { handleGroupParticipantUpdate } = require('./commands/group');
      try {
        await handleGroupParticipantUpdate(sock, data);
      } catch (err) {
        console.error('[EVO] Group participant update error:', err.message);
      }
      break;
    }

    case 'call':
    case 'CALL': {
      const calls = Array.isArray(data) ? data : [data];
      for (const call of calls) {
        if (call?.status !== 'offer') continue;
        const callerJid = call.from || call.chatId;
        const isDM = callerJid?.endsWith('@s.whatsapp.net');
        if (!isDM) continue;
        if (!db.getBotSetting('anticallDm')) continue;
        const customMsg = db.getBotSetting('antiCallMsg');
        const channelLink = db.getBotSetting('channelLink');
        const channelSuffix = channelLink ? `\n\n» *Follow our channel:* ${channelLink}` : '';
        const text = customMsg ||
          `▲ *Call Blocked!*\n\n[NO-MOB] This bot does not accept calls.\n` +
          `» Please send a text message instead.${channelSuffix}\n\n_Powered by ★ Firebox_`;
        try { await sock.sendMessage(callerJid, { text }); } catch (_) {}
      }
      break;
    }

    default:
      // Ignore other events silently
      break;
  }
}

// ── Normalize Evolution API message to Baileys-compatible format ───────────────

function normalizeMessage(data) {
  if (!data) return null;

  // If it already has a Baileys-format key, use it directly
  if (data.key && data.message) {
    return {
      key: {
        id:          data.key.id,
        remoteJid:   data.key.remoteJid,
        fromMe:      data.key.fromMe || false,
        participant: data.key.participant,
      },
      message:          data.message,
      messageTimestamp: data.messageTimestamp || Math.floor(Date.now() / 1000),
      pushName:         data.pushName || '',
    };
  }

  // Evolution API v2 format
  const key = {
    id:          data.key?.id || data.id || '',
    remoteJid:   data.key?.remoteJid || data.remoteJid || data.from || '',
    fromMe:      data.key?.fromMe || data.fromMe || false,
    participant: data.key?.participant || data.participant || undefined,
  };

  const messageType = data.messageType || 'conversation';
  let message = data.message || {};

  // If Evolution API sends a flattened structure, rebuild the message object
  if (Object.keys(message).length === 0) {
    if (data.body) {
      message = { conversation: data.body };
    } else if (messageType === 'conversation' && data.body) {
      message = { conversation: data.body };
    }
  }

  if (!key.remoteJid || !key.id) return null;

  return {
    key,
    message,
    messageTimestamp: data.messageTimestamp || Math.floor(Date.now() / 1000),
    pushName:         data.pushName || data.senderName || '',
  };
}

module.exports = {
  sessions,
  addSession,
  startSession: startEvoSession,
  removeSession,
  requestPairingCode,
  waitForPairingReady,
  loadAndStartAll,
  handleWebhookEvent,
  isSetupRequired,
};
