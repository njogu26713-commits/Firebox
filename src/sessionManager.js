const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  downloadContentFromMessage,
  getContentType
} = require('@whiskeysockets/baileys');
const { openRouterVision } = require('./openrouter');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');

const { createSessionState, addActivity } = require('./state');
const db = require('./database');
const { sendFireboxCard } = require('./card');

const SESSIONS_FILE = path.join(__dirname, '../data/sessions.json');
const SESSION_BASE  = path.join(__dirname, '../session');
const PREFIX        = process.env.PREFIX || '.';

const sessions = new Map(); // id -> sessionState

// Global dedup cache — prevents two sessions in the same group from both replying
const _handledMsgIds = new Map(); // msgId -> timestamp
const DEDUP_TTL = 60 * 1000; // 60 seconds

// ── persistence ──────────────────────────────────────────────────────────────

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
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2));
}

// ── migrate legacy single-session if needed ───────────────────────────────────

function migrateLegacySession() {
  const legacyCreds = path.join(SESSION_BASE, 'creds.json');
  if (!fs.existsSync(legacyCreds)) return null;

  const id = 'sess_legacy';
  const destDir = path.join(SESSION_BASE, id);
  if (fs.existsSync(destDir)) return id; // already migrated

  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(SESSION_BASE).filter(
    f => !fs.statSync(path.join(SESSION_BASE, f)).isDirectory()
  );
  for (const f of files) {
    fs.copyFileSync(path.join(SESSION_BASE, f), path.join(destDir, f));
  }
  console.log('[SESSIONS] Migrated legacy session → sess_legacy');
  return id;
}

// ── start one WhatsApp session ────────────────────────────────────────────────

async function startSession(id, name, createdAt) {
  let sessionState = sessions.get(id);
  if (!sessionState) {
    sessionState = createSessionState(id, name);
    sessionState.createdAt = createdAt || Date.now();
    sessionState.awayMode = db.getBotSetting('awayMode') || false;
    sessionState.awayMsg = db.getBotSetting('awayMsg') || sessionState.awayMsg;
    sessions.set(id, sessionState);
  } else {
    sessionState.status = 'connecting';
  }

  const sessionDir = path.join(SESSION_BASE, id);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Cache the WA version — fetchLatestBaileysVersion() hits a remote server every call.
  // Re-fetch only once every 6 hours so reconnects don't add network latency.
  if (!startSession._cachedVersion || Date.now() - startSession._versionTs > 6 * 60 * 60 * 1000) {
    try {
      const result = await fetchLatestBaileysVersion();
      startSession._cachedVersion = result.version;
      startSession._versionTs = Date.now();
    } catch (_) {
      if (!startSession._cachedVersion) startSession._cachedVersion = [2, 3000, 1015901307];
    }
  }
  const version = startSession._cachedVersion;

  const nullLogger = pino({ level: 'silent' }, { write: () => {} });

  const sock = makeWASocket({
    version,
    logger: nullLogger,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, nullLogger)
    },
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 250,
    maxMsgRetryCount: 5
  });

  sessionState.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  // ── scheduler ──
  const schedulerInterval = setInterval(async () => {
    // Daily coin auto-refill — runs once per day regardless of session state
    db.checkAndApplyDailyRefill();

    if (sessionState.status !== 'connected') return;
    const now = Date.now();
    const due = db.getSchedules().filter(s => s.jid && s.sendAt <= now);
    for (const s of due) {
      try {
        await sock.sendMessage(s.jid, { text: `⏰ *Scheduled Message*\n\n${s.message}` });
        db.removeSchedule(s.id);
      } catch (err) {
        db.removeSchedule(s.id);
      }
    }
  }, 30000);

  if (!sessionState._reconnectDelay) sessionState._reconnectDelay = 3000;
  if (!sessionState._440Delay) sessionState._440Delay = 10000;
  if (!sessionState._connectedAt) sessionState._connectedAt = 0;

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      sessionState.qr = qr;
      sessionState.pairingCode = null;
    }

    if (connection === 'close') {
      clearInterval(schedulerInterval);
      sessionState.status = 'disconnected';
      sessionState.number = null;
      sessionState.qr = null;
      sessionState.sock = null;

      // If the session was intentionally removed, do not reconnect
      if (sessionState._removed) {
        console.log(`[${id}] Session was removed — skipping reconnect.`);
        return;
      }

      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
        console.log(`[${id}] Logged out (code ${code}). Removing session.`);
        sessions.delete(id);
        saveSessionList();
      } else if (code === DisconnectReason.connectionReplaced) {
        // Another active connection took over — use a separate 440 backoff so a
        // brief successful reconnect doesn't reset it back to 3s.
        const delay = sessionState._440Delay;
        sessionState._440Delay = Math.min(delay * 2, 300000); // cap at 5 min
        // Stagger per session index to prevent simultaneous reconnect storms
        const sessionIndex = [...sessions.keys()].indexOf(id);
        const stagger = (sessionIndex >= 0 ? sessionIndex : 0) * 5000;
        const totalDelay = delay + stagger;
        console.log(`[${id}] Connection replaced (440) — waiting ${Math.round(totalDelay/1000)}s before retry...`);
        sessionState.status = 'connecting';
        setTimeout(() => startSession(id, sessionState.name, sessionState.createdAt), totalDelay);
      } else if (code === DisconnectReason.restartRequired) {
        // Server asked for immediate restart
        sessionState._reconnectDelay = 3000;
        console.log(`[${id}] Restart required — reconnecting in 3s...`);
        sessionState.status = 'connecting';
        setTimeout(() => startSession(id, sessionState.name, sessionState.createdAt), 3000);
      } else if (code === DisconnectReason.badSession) {
        // Corrupted session — clear signal keys and re-auth
        console.log(`[${id}] Bad session — clearing signal keys and reconnecting...`);
        const sessionDir = path.join(SESSION_BASE, id);
        try {
          const files = fs.readdirSync(sessionDir).filter(f =>
            f.startsWith('session-') || f.startsWith('sender-key-') || f.startsWith('identity-key-')
          );
          for (const f of files) fs.unlinkSync(path.join(sessionDir, f));
          console.log(`[${id}] Cleared ${files.length} stale key file(s).`);
        } catch (_) {}
        sessionState._reconnectDelay = 5000;
        sessionState.status = 'connecting';
        setTimeout(() => startSession(id, sessionState.name, sessionState.createdAt), 5000);
      } else {
        // All other codes: reconnect with mild backoff
        const delay = sessionState._reconnectDelay || 3000;
        sessionState._reconnectDelay = Math.min(delay * 1.5, 30000);
        console.log(`[${id}] Reconnecting in ${Math.round(delay/1000)}s... (code ${code})`);
        sessionState.status = 'connecting';
        setTimeout(() => startSession(id, sessionState.name, sessionState.createdAt), delay);
      }
    } else if (connection === 'open') {
      const user = sock.user?.id?.split(':')[0];
      sessionState.status = 'connected';
      sessionState._connectedAt = Date.now();
      sessionState._reconnectDelay = 3000; // reset general backoff on successful connect
      // Only reset 440 backoff if we've been stable for at least 60 seconds
      setTimeout(() => {
        if (sessionState.status === 'connected' && Date.now() - sessionState._connectedAt >= 60000) {
          sessionState._440Delay = 30000;
        }
      }, 60000);
      sessionState.number = user;
      sessionState.qr = null;
      sessionState.pairingCode = null;
      console.log(`[${id}] Connected! +${user}`);
      try {
        const selfJid = sock.user?.id;

        // ── Generate base64 session export ──────────────────────────────────
        let sessionIdStr = '_Could not export session_';
        try {
          const sessionDir = path.join(SESSION_BASE, id);
          const files = fs.readdirSync(sessionDir);
          const bundle = {};
          for (const file of files) {
            const filePath = path.join(sessionDir, file);
            if (fs.statSync(filePath).isFile()) {
              bundle[file] = fs.readFileSync(filePath, 'utf8');
            }
          }
          sessionIdStr = Buffer.from(JSON.stringify(bundle)).toString('base64');
        } catch (_) {}

        const cardContent =
          `📱 *Number:* +${user}\n` +
          `🏷️ *Session:* ${sessionState.name}\n` +
          `⏰ *Time:* ${new Date().toLocaleString()}\n\n` +
          `*🔑 Session ID (copy for deployment):*\n\`\`\`${sessionIdStr}\`\`\`\n\n` +
          `_Paste this into the *SESSION_ID* field on the Config page to deploy._`;

        const fakeMsg = null; // no incoming msg to quote
        if (selfJid) {
          await sendFireboxCard(sock, selfJid, fakeMsg, {
            title: '✅ Firebox Connected!',
            content: cardContent,
            noQuote: true,
          });
        }

        const ownerNumber = process.env.OWNER_NUMBER;
        if (ownerNumber) {
          const ownerJid = ownerNumber + '@s.whatsapp.net';
          if (ownerJid !== selfJid) {
            await sendFireboxCard(sock, ownerJid, fakeMsg, {
              title: '✅ Firebox Connected!',
              content: cardContent,
              noQuote: true,
            });
          }
        }

      } catch (_) {}
    } else if (connection === 'connecting') {
      sessionState.status = 'connecting';
    }
  });

  // ── Anti-call DM: reject + warn on private calls ─────────────────────────
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status !== 'offer') continue; // only act on incoming offers
      const callerJid = call.from;
      const isDM = callerJid.endsWith('@s.whatsapp.net');

      // Only handle DM calls here; group calls are handled per-group via .anticall
      if (!isDM) continue;

      const anticallDm = db.getBotSetting('anticallDm');
      if (!anticallDm) continue; // DM anticall is off

      try {
        await sock.rejectCall(call.id, callerJid);
        console.log(`[ANTICALL-DM][${id}] Rejected DM call from ${callerJid.split('@')[0]}`);
      } catch (err) {
        console.error(`[ANTICALL-DM][${id}] Reject failed:`, err.message);
      }
      try {
        const customMsg = db.getBotSetting('antiCallMsg');
        const callChannelLink = db.getBotSetting('channelLink');
        const callChannelSuffix = callChannelLink ? `\n\n📢 *Follow our channel:* ${callChannelLink}` : '';
        const text = customMsg ||
          `⚠️ *Call Blocked!*\n\n` +
          `📵 This bot does not accept calls.\n` +
          `💬 Please send a text message instead.${callChannelSuffix}\n\n` +
          `_Powered by 🔥 Firebox_`;
        await sock.sendMessage(callerJid, { text });
      } catch (err) {
        console.error(`[ANTICALL-DM][${id}] Warning message failed:`, err.message);
      }
    }
  });

  const MSG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  const VIEW_ONCE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  // Unwrap view-once wrappers — returns { type, msgForDownload, mediaData } or null
  function extractViewOnce(msg) {
    const m = msg.message;
    if (!m) return null;

    // ── Wrapped format (viewOnceMessage / V2 / V2Extension) ──────────────────
    const wrapped =
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message;
    if (wrapped) {
      const type = getContentType(wrapped);
      if (['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) {
        return { type, msgForDownload: { ...msg, message: wrapped }, mediaData: wrapped[type] };
      }
    }

    // ── Ephemeral / device-sent — recurse one level ───────────────────────────
    if (m.ephemeralMessage?.message)
      return extractViewOnce({ ...msg, message: m.ephemeralMessage.message });
    if (m.deviceSentMessage?.message)
      return extractViewOnce({ ...msg, message: m.deviceSentMessage.message });

    // ── Newer WhatsApp: viewOnce flag directly on the media message ───────────
    // viewOnce can be boolean true OR number 1 depending on WA client version
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
      if (m[type]?.viewOnce) {
        return { type, msgForDownload: msg, mediaData: m[type] };
      }
    }

    return null;
  }

  async function cacheViewOnce(msg) {
    if (!msg.message) return;
    const result = extractViewOnce(msg);
    if (!result) return;

    const { type, msgForDownload, mediaData } = result;
    const id = msg.key.id;
    if (sessionState.viewOnceCache.get(id)?.buffer) return; // already cached

    console.log(`[VV] Detected view-once id=${id} type=${type} — downloading...`);
    try {
      const buffer = await downloadMediaMessage(
        msgForDownload,
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );
      sessionState.viewOnceCache.set(id, {
        buffer, type,
        mimetype: mediaData?.mimetype,
        ptt: mediaData?.ptt || false,
        sender: msg.key.participant || msg.key.remoteJid,
        ts: Date.now()
      });
      console.log(`[VV] Cached view-once id=${id} type=${type} size=${buffer.length}b`);
      setTimeout(() => sessionState.viewOnceCache.delete(id), VIEW_ONCE_CACHE_TTL);
    } catch (err) {
      console.error(`[VV] Download failed id=${id}:`, err.message);
    }
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const { handleMessage } = require('./handler');
    // getContentType is already imported at top level

    for (const msg of messages) {
      if (!msg.message) continue;

      // ── Skip messages sent before this session connected (replay on restart) ──
      const msgTs = Number(msg.messageTimestamp || 0) * 1000;
      if (msgTs > 0 && msgTs < sessionState._connectedAt) continue;

      // ── Cache view-once media BEFORE dedup so every session can store it ────
      if (msg.key.remoteJid !== 'status@broadcast') {
        cacheViewOnce(msg).catch(err =>
          console.error('[VV] Unexpected error:', err.message)
        );
      }

      // ── Global dedup: only one session handles each message ───────────────
      const msgId = msg.key.id;
      if (msgId) {
        if (_handledMsgIds.has(msgId)) continue; // another session already handled it
        _handledMsgIds.set(msgId, Date.now());
        setTimeout(() => _handledMsgIds.delete(msgId), DEDUP_TTL);
      }

      if (msg.key.remoteJid === 'status@broadcast') {
        const statusProto = msg.message?.protocolMessage;
        const statusProtoType = statusProto?.type;

        // ── Detect deleted status (REVOKE on status@broadcast) ──────────────
        if ((statusProtoType === 0 || statusProtoType === 'REVOKE') && statusProto?.key?.id) {
          if (db.getBotSetting('antiDeleteStatus')) {
            const ownerNumber = process.env.OWNER_NUMBER;
            if (ownerNumber) {
              const ownerJid = ownerNumber + '@s.whatsapp.net';
              const cached = sessionState.statusCache.get(statusProto.key.id);
              if (cached) {
                sessionState.statusCache.delete(statusProto.key.id);
                const { mType, poster, cachedMsg, mediaBuffer } = cached;
                const posterTag = poster ? poster.split('@')[0] : 'unknown';
                const header = `🗑️ *Deleted Status*\n👤 *By:* @${posterTag}\n⏰ *Deleted:* just now\n\n`;
                try {
                  if (mType === 'imageMessage') {
                    const imgCaption = cachedMsg.message?.imageMessage?.caption || '📷 Image status';
                    if (mediaBuffer) {
                      await sock.sendMessage(ownerJid, {
                        image: mediaBuffer,
                        caption: header + imgCaption,
                        mentions: [poster].filter(Boolean)
                      });
                    } else {
                      await sock.sendMessage(ownerJid, {
                        text: header + `📷 *Image status* (could not retrieve media)\n${imgCaption}`,
                        mentions: [poster].filter(Boolean)
                      });
                    }
                  } else if (mType === 'videoMessage') {
                    const vidCaption = cachedMsg.message?.videoMessage?.caption || '🎬 Video status';
                    if (mediaBuffer) {
                      await sock.sendMessage(ownerJid, {
                        video: mediaBuffer,
                        mimetype: 'video/mp4',
                        caption: header + vidCaption,
                        mentions: [poster].filter(Boolean)
                      });
                    } else {
                      await sock.sendMessage(ownerJid, {
                        text: header + `🎬 *Video status* (could not retrieve media)\n${vidCaption}`,
                        mentions: [poster].filter(Boolean)
                      });
                    }
                  } else if (mType === 'audioMessage') {
                    if (mediaBuffer) {
                      await sock.sendMessage(ownerJid, {
                        audio: mediaBuffer,
                        mimetype: 'audio/mp4',
                        ptt: false
                      });
                      await sock.sendMessage(ownerJid, {
                        text: header + '🎵 *Audio status (above)*',
                        mentions: [poster].filter(Boolean)
                      });
                    } else {
                      await sock.sendMessage(ownerJid, {
                        text: header + '🎵 *Audio status* (could not retrieve media)',
                        mentions: [poster].filter(Boolean)
                      });
                    }
                  } else if (mType === 'conversation' || mType === 'extendedTextMessage') {
                    const body = cachedMsg.message?.conversation || cachedMsg.message?.extendedTextMessage?.text || '';
                    await sock.sendMessage(ownerJid, {
                      text: header + `📝 *Status text:*\n${body}`,
                      mentions: [poster].filter(Boolean)
                    });
                  } else {
                    await sock.sendMessage(ownerJid, {
                      text: header + `_[${mType || 'Unknown type'}]_`,
                      mentions: [poster].filter(Boolean)
                    });
                  }
                } catch (err) {
                  console.error(`[${id}] Anti-delete-status error:`, err.message);
                }
              }
            }
          }
          continue;
        }

        // ── Cache status for antideletestatus ────────────────────────────────
        if (!msg.key.fromMe && msg.message) {
          const mType = getContentType(msg.message);
          const poster = msg.key.participant || msg.key.remoteJid;
          if (mType && mType !== 'protocolMessage') {
            const entry = { mType, poster, ts: Date.now(), cachedMsg: msg, mediaBuffer: null };
            sessionState.statusCache.set(msg.key.id, entry);
            setTimeout(() => sessionState.statusCache.delete(msg.key.id), 24 * 60 * 60 * 1000);
            // Pre-download media buffer only when antiDeleteStatus is on — saves bandwidth otherwise
            if (['imageMessage', 'videoMessage', 'audioMessage'].includes(mType) && db.getBotSetting('antiDeleteStatus')) {
              (async () => {
                try {
                  const buf = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                  entry.mediaBuffer = buf;
                } catch (e) {
                  console.error(`[${id}] Status media pre-download failed:`, e.message);
                }
              })();
            }
          }
        }

        if (db.getBotSetting('autoViewStatus')) {
          try { await sock.readMessages([msg.key]); } catch (_) {}
        }
        if (!msg.key.fromMe) {
          const posterJid = msg.key.participant || msg.key.remoteJid;
          if (db.getBotSetting('autoReactStatus')) {
            const emojiSetting = db.getBotSetting('autoReactEmoji') || '🔥';
            let emoji;
            if (emojiSetting === 'random') {
              const pool = ['🔥','❤️','😍','💯','🎉','😂','👏','🥳','😎','💪','🤩','✨','😜','🙌','💥'];
              emoji = pool[Math.floor(Math.random() * pool.length)];
            } else {
              emoji = emojiSetting;
            }
            try {
              await sock.sendMessage(posterJid, { react: { text: emoji, key: msg.key } });
              const sType = getContentType(msg.message) || 'unknown';
              db.recordStatusReact(posterJid, emoji, sType);
            } catch (_) {}
          }
          if (db.getBotSetting('autoStatusReply')) {
            try {
              const statusType = getContentType(msg.message) || '';
              let replyMsg;

              if (statusType === 'imageMessage') {
                const custom = db.getBotSetting('autoStatusReplyImg');
                if (custom) {
                  replyMsg = custom;
                } else {
                  // Try AI vision — read the meme/image and reply smartly
                  try {
                    const imgData = msg.message.imageMessage;
                    const stream = await downloadContentFromMessage(imgData, 'image');
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    const imgBuffer = Buffer.concat(chunks);
                    const mimeType = imgData.mimetype || 'image/jpeg';
                    replyMsg = await openRouterVision(
                      imgBuffer,
                      mimeType,
                      'This is a WhatsApp status image (could be a meme, quote, photo, or selfie). ' +
                      'React to it exactly like a close friend would in ONE short casual sentence — ' +
                      'if it has text or a meme caption, engage with that directly. ' +
                      'Be genuine and natural, max 12 words, add 1 fitting emoji. ' +
                      'Do NOT say "I can see" or "This image shows" — just react.'
                    );
                  } catch (_) {
                    const defaults = ['Fire pic! 😍🔥', 'Looking good! 💯', 'Banger! 🔥', 'Vibes! ✨', 'Great shot! 📸', 'W pic 😤🔥', 'Sheeeesh! 😩🔥'];
                    replyMsg = defaults[Math.floor(Math.random() * defaults.length)];
                  }
                }
              } else if (statusType === 'videoMessage') {
                const custom = db.getBotSetting('autoStatusReplyVideo');
                const defaults = ['This vid tho! 🎬🔥', 'Banger content! 💯', 'W video! 🎥', 'Vibes on another level! 🔥', 'Clip of the day! 🎬', 'Sheeeesh the video! 😩🔥', 'Too cold! ❄️🔥'];
                replyMsg = custom || defaults[Math.floor(Math.random() * defaults.length)];
              } else {
                const custom = db.getBotSetting('autoStatusReplyMsg');
                const defaults = ['Facts! 💯', 'Said! 🔥', "That's deep 🤔", 'Real talk! 💬', 'Interesting thought ✨', 'Noted! 👀', 'This one hit different 🥹'];
                replyMsg = custom || defaults[Math.floor(Math.random() * defaults.length)];
              }
              await sock.sendMessage(posterJid, { text: replyMsg }, { quoted: msg });
            } catch (_) {}
          }
        }
        continue;
      }

      // ── cache every message (including bot's own) for anti-delete/edit ──
      {
        const m = msg.message;
        const mType = getContentType(m);
        const sender = msg.key.participant || msg.key.remoteJid;
        const from   = msg.key.remoteJid;

        // Only cache real content messages (not protocol/revoke/edit wrappers)
        const skipTypes = ['protocolMessage', 'reactionMessage', 'pollUpdateMessage', 'editedMessage'];
        if (mType && !skipTypes.includes(mType)) {
          const body =
            mType === 'conversation'           ? m.conversation :
            mType === 'extendedTextMessage'    ? m.extendedTextMessage?.text :
            mType === 'imageMessage'           ? (m.imageMessage?.caption || '[Image]') :
            mType === 'videoMessage'           ? (m.videoMessage?.caption || '[Video]') :
            mType === 'documentMessage'        ? (m.documentMessage?.fileName || '[Document]') :
            mType === 'audioMessage'           ? '[Voice Note]' :
            mType === 'stickerMessage'         ? '[Sticker]' : `[${mType}]`;

          const msgEntry = { body, mType, sender, from, ts: Date.now(), msg, mediaBuffer: null };
          sessionState.messageCache.set(msg.key.id, msgEntry);
          setTimeout(() => sessionState.messageCache.delete(msg.key.id), MSG_CACHE_TTL);
          // Pre-download media only when antiDelete is on — saves bandwidth otherwise
          if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage'].includes(mType) && db.getBotSetting('antiDelete')) {
            (async () => {
              try {
                const buf = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
                msgEntry.mediaBuffer = buf;
              } catch (e) {
                console.error(`[${id}] Msg media pre-download failed:`, e.message);
              }
            })();
          }
        }
      }

      // ── anti-delete + anti-edit: both arrive via protocolMessage ─────────
      const ownerNumber = process.env.OWNER_NUMBER;
      if (ownerNumber) {
        const ownerJid = ownerNumber + '@s.whatsapp.net';
        const m = msg.message;
        const proto = m?.protocolMessage;
        const protoType = proto?.type;

        // ── DELETE: protocolMessage type 0 = REVOKE (delete for everyone) ──
        if ((protoType === 0 || protoType === 'REVOKE') && proto?.key?.id) {
          const deletedId = proto.key.id;
          const cached = sessionState.messageCache.get(deletedId);

          if (cached && db.getBotSetting('antiDelete')) {
            sessionState.messageCache.delete(deletedId);
            const { body, mType, sender, from: chatFrom, msg: cachedMsg, mediaBuffer } = cached;
            const deleter    = msg.key.participant || msg.key.remoteJid;
            const isGroup    = chatFrom?.endsWith('@g.us');
            const senderTag  = sender  ? sender.split('@')[0]  : 'unknown';
            const deleterTag = deleter ? deleter.split('@')[0] : senderTag;
            const chatLabel  = isGroup ? `group ${chatFrom?.split('@')[0]}` : `DM`;

            const header = `🗑️ *Deleted Message*\n👤 *By:* @${deleterTag}\n💬 *Chat:* ${chatLabel}\n\n`;

            try {
              if (mType === 'imageMessage') {
                const cap = body && body !== '[Image]' ? `📝 ${body}` : '📷 Image';
                if (mediaBuffer) {
                  await sock.sendMessage(ownerJid, { image: mediaBuffer, caption: header + cap, mentions: [sender, deleter].filter(Boolean) });
                } else {
                  await sock.sendMessage(ownerJid, { text: header + `📷 *Image* (media unavailable)\n${cap}`, mentions: [sender, deleter].filter(Boolean) });
                }
              } else if (mType === 'videoMessage') {
                const cap = body && body !== '[Video]' ? `📝 ${body}` : '🎬 Video';
                if (mediaBuffer) {
                  await sock.sendMessage(ownerJid, { video: mediaBuffer, mimetype: 'video/mp4', caption: header + cap, mentions: [sender, deleter].filter(Boolean) });
                } else {
                  await sock.sendMessage(ownerJid, { text: header + `🎬 *Video* (media unavailable)\n${cap}`, mentions: [sender, deleter].filter(Boolean) });
                }
              } else if (mType === 'audioMessage') {
                if (mediaBuffer) {
                  const isPtt = cachedMsg?.message?.audioMessage?.ptt || false;
                  await sock.sendMessage(ownerJid, { audio: mediaBuffer, mimetype: 'audio/mp4', ptt: isPtt });
                  await sock.sendMessage(ownerJid, { text: header + '🎤 Voice Note (above)', mentions: [sender, deleter].filter(Boolean) });
                } else {
                  await sock.sendMessage(ownerJid, { text: header + '🎤 *Voice Note* (media unavailable)', mentions: [sender, deleter].filter(Boolean) });
                }
              } else if (mType === 'stickerMessage') {
                if (mediaBuffer) {
                  await sock.sendMessage(ownerJid, { sticker: mediaBuffer });
                  await sock.sendMessage(ownerJid, { text: header + '🎭 Sticker (above)', mentions: [sender, deleter].filter(Boolean) });
                } else {
                  await sock.sendMessage(ownerJid, { text: header + '🎭 *Sticker* (media unavailable)', mentions: [sender, deleter].filter(Boolean) });
                }
              } else {
                await sock.sendMessage(ownerJid, {
                  text: header + `📝 *Message:*\n${body || '_(unknown content)_'}`,
                  mentions: [sender, deleter].filter(Boolean)
                });
              }
            } catch (err) {
              console.error(`[${id}] Anti-delete error:`, err.message);
            }
          }
        }

        // ── EDIT: protocolMessage type 14 or editedMessage wrapper ─────────
        const isEditProto = (protoType === 14 || protoType === 'REVOKE_V2' || String(protoType) === '14') && proto?.key;
        const editedMsg   = m?.editedMessage;

        if (isEditProto || editedMsg) {
          const originalKey = isEditProto ? proto.key?.id : editedMsg?.key?.id;
          const cached = originalKey ? sessionState.messageCache.get(originalKey) : null;

          const newContent = isEditProto
            ? (proto.editedMessage?.conversation ||
               proto.editedMessage?.extendedTextMessage?.text ||
               proto.editedMessage?.imageMessage?.caption ||
               proto.editedMessage?.videoMessage?.caption || '')
            : (editedMsg?.message?.conversation ||
               editedMsg?.message?.extendedTextMessage?.text || '');

          if (newContent && cached && cached.body !== newContent && db.getBotSetting('antiEdit')) {
            const { body: origBody, from: chatFrom, sender: editSender } = cached;
            const isGroup   = chatFrom?.endsWith('@g.us');
            const senderTag = editSender ? editSender.split('@')[0] : 'unknown';
            const chatLabel = isGroup ? `group ${chatFrom?.split('@')[0]}` : `DM`;
            try {
              await sock.sendMessage(ownerJid, {
                text: `✏️ *Message Edited*\n👤 *By:* @${senderTag}\n💬 *Chat:* ${chatLabel}\n\n📝 *Original:*\n${origBody || '_(empty)_'}\n\n🔄 *Edited to:*\n${newContent}`,
                mentions: editSender ? [editSender] : []
              });
            } catch (err) {
              console.error(`[${id}] Anti-edit error:`, err.message);
            }
            if (originalKey) {
              sessionState.messageCache.set(originalKey, { ...cached, body: newContent });
            }
          }
        }
      }

      try {
        await handleMessage(sock, msg, PREFIX, sessionState);
      } catch (err) {
        console.error(`[${id}] Error:`, err.message);
      }
    }
  });

  // ── anti-delete: catch message deletions ────────────────────────────────
  sock.ev.on('messages.delete', async ({ keys }) => {
    const ownerNumber = process.env.OWNER_NUMBER;
    if (!ownerNumber) return;
    const ownerJid = ownerNumber + '@s.whatsapp.net';

    for (const key of keys) {
      const cached = sessionState.messageCache.get(key.id);
      if (!cached) continue;
      sessionState.messageCache.delete(key.id);

      const { body, mType, sender, from, msg: cachedMsg, mediaBuffer } = cached;
      const isGroup = from.endsWith('@g.us');

      const senderTag = sender ? sender.split('@')[0] : 'unknown';
      const chatLabel  = isGroup ? `group ${from.split('@')[0]}` : `DM with ${senderTag}`;
      const header = `🗑️ *Deleted Message Detected*\n👤 *From:* @${senderTag}\n💬 *Chat:* ${chatLabel}\n`;

      try {
        if (mType === 'imageMessage') {
          const cap = body ? `📝 *Caption:* ${body}` : '📷 Image';
          if (mediaBuffer) {
            await sock.sendMessage(ownerJid, { image: mediaBuffer, caption: header + cap, mentions: sender ? [sender] : [] });
          } else {
            await sock.sendMessage(ownerJid, { text: header + `📷 *Image* (media unavailable)\n${cap}`, mentions: sender ? [sender] : [] });
          }
        } else if (mType === 'videoMessage') {
          const cap = body ? `📝 *Caption:* ${body}` : '🎬 Video';
          if (mediaBuffer) {
            await sock.sendMessage(ownerJid, { video: mediaBuffer, mimetype: 'video/mp4', caption: header + cap, mentions: sender ? [sender] : [] });
          } else {
            await sock.sendMessage(ownerJid, { text: header + `🎬 *Video* (media unavailable)\n${cap}`, mentions: sender ? [sender] : [] });
          }
        } else if (mType === 'audioMessage') {
          if (mediaBuffer) {
            const isPtt = cachedMsg?.message?.audioMessage?.ptt || false;
            await sock.sendMessage(ownerJid, { audio: mediaBuffer, mimetype: 'audio/mp4', ptt: isPtt });
            await sock.sendMessage(ownerJid, { text: header + '🎤 *Voice Note (above)*', mentions: sender ? [sender] : [] });
          } else {
            await sock.sendMessage(ownerJid, { text: header + '🎤 *Voice Note* (media unavailable)', mentions: sender ? [sender] : [] });
          }
        } else if (mType === 'stickerMessage') {
          if (mediaBuffer) {
            await sock.sendMessage(ownerJid, { sticker: mediaBuffer });
            await sock.sendMessage(ownerJid, { text: header + '🎭 *Sticker (above)*', mentions: sender ? [sender] : [] });
          } else {
            await sock.sendMessage(ownerJid, { text: header + '🎭 *Sticker* (media unavailable)', mentions: sender ? [sender] : [] });
          }
        } else if (body) {
          await sock.sendMessage(ownerJid, {
            text: header + `📝 *Message:*\n${body}`,
            mentions: sender ? [sender] : []
          });
        }
      } catch (err) {
        console.error(`[${id}] Anti-delete forward error:`, err.message);
      }
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const { handleGroupParticipantUpdate } = require('./commands/group');
    try {
      await handleGroupParticipantUpdate(sock, update);
    } catch (err) {
      console.error(`[${id}] Group update error:`, err.message);
    }
  });

  return sessionState;
}

// ── public API ────────────────────────────────────────────────────────────────

async function addSession(name) {
  const id = 'sess_' + Date.now();
  const sessionState = await startSession(id, name || `Session ${sessions.size + 1}`);
  saveSessionList();
  return sessionState;
}

function removeSession(id) {
  const s = sessions.get(id);
  if (s) s._removed = true;
  if (s?.sock) { try { s.sock.end(new Error('removed')); } catch {} }
  sessions.delete(id);
  saveSessionList();

  const sessionDir = path.join(SESSION_BASE, id);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}

async function requestPairingCode(id, number) {
  const s = sessions.get(id);
  if (!s?.sock) throw new Error('Session socket not ready');
  if (s.status === 'connected') throw new Error('Already connected');
  const clean = number.replace(/[^0-9]/g, '');
  const code = await s.sock.requestPairingCode(clean);
  const formatted = code.match(/.{1,4}/g).join('-');
  s.pairingCode = formatted;
  return formatted;
}

// ── Check if setup is required (no session configured yet) ────────────────────

function isSetupRequired() {
  // Has any session directory with creds on disk?
  if (fs.existsSync(SESSION_BASE)) {
    for (const entry of fs.readdirSync(SESSION_BASE)) {
      const credsPath = path.join(SESSION_BASE, entry, 'creds.json');
      if (fs.existsSync(credsPath)) return false;
    }
  }

  return true;
}

async function loadAndStartAll() {
  if (!fs.existsSync(path.join(__dirname, '../data'))) {
    fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
  }

  if (isSetupRequired()) {
    console.log('[SESSIONS] ⚠️  No session found. Open the dashboard to pair a bot.');
    return;
  }

  const list = loadSessionList();

  // Remove any orphan session directories not in the active list
  const knownIds = new Set(list.map(s => s.id));
  if (fs.existsSync(SESSION_BASE)) {
    for (const entry of fs.readdirSync(SESSION_BASE)) {
      if (!entry.startsWith('sess_')) continue;
      if (!knownIds.has(entry)) {
        try {
          fs.rmSync(path.join(SESSION_BASE, entry), { recursive: true, force: true });
          console.log(`[SESSIONS] Removed orphan session dir: ${entry}`);
        } catch (_) {}
      }
    }
  }

  console.log(`[SESSIONS] Starting ${list.length} session(s)...`);
  for (let i = 0; i < list.length; i++) {
    const { id, name, createdAt } = list[i];
    if (i > 0) await new Promise(r => setTimeout(r, 3000));
    await startSession(id, name, createdAt);
  }
}

module.exports = { sessions, addSession, startSession, removeSession, requestPairingCode, loadAndStartAll };
