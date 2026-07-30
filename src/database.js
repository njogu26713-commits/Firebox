const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../data');

// ── In-memory store (source of truth for synchronous reads) ──────────────────
const _mem = {};

// ── MongoDB state ─────────────────────────────────────────────────────────────
let _mongoClient = null;
let _mongoDb     = null;

// ── Collection key → { file, fallback } map ──────────────────────────────────
const STORE_KEYS = {
  groups:      { file: path.join(DATA_DIR, 'groups.json'),      fallback: {} },
  users:       { file: path.join(DATA_DIR, 'users.json'),       fallback: {} },
  trivia:      { file: path.join(DATA_DIR, 'trivia.json'),      fallback: {} },
  warns:       { file: path.join(DATA_DIR, 'warns.json'),       fallback: {} },
  settings:    { file: path.join(DATA_DIR, 'settings.json'),    fallback: {} },
  schedules:   { file: path.join(DATA_DIR, 'schedules.json'),   fallback: [] },
  confessions: { file: path.join(DATA_DIR, 'confessions.json'), fallback: [] },
  broadcast:   { file: path.join(DATA_DIR, 'broadcast.json'),   fallback: [] },
  statusstats: { file: path.join(DATA_DIR, 'statusstats.json'), fallback: {} },
  coins:       { file: path.join(DATA_DIR, 'coins.json'),       fallback: { balance: 20, totalSpent: 0, history: [] } },
  tokens:      { file: path.join(DATA_DIR, 'tokens.json'),      fallback: {} },
  payments:    { file: path.join(DATA_DIR, 'payments.json'),    fallback: {} },
};

// ── MongoDB helpers ───────────────────────────────────────────────────────────

async function mongoConnect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[DB] MONGODB_URI not set — using JSON files only');
    return false;
  }
  try {
    const { MongoClient } = require('mongodb');
    _mongoClient = new MongoClient(uri, {
      connectTimeoutMS:          15000,
      serverSelectionTimeoutMS:  15000,
    });
    await _mongoClient.connect();

    // Parse the database name from the URI path, defaulting to 'firebox'
    let dbName = 'firebox';
    try {
      const match = uri.match(/\/([^/?#]+)(\?|#|$)/);
      if (match && match[1]) dbName = match[1];
    } catch {}

    _mongoDb = _mongoClient.db(dbName);
    console.log(`[DB] MongoDB connected — database: "${dbName}"`);
    return true;
  } catch (err) {
    console.error('[DB] MongoDB connection failed:', err.message);
    return false;
  }
}

async function mongoLoad(key) {
  if (!_mongoDb) return null;
  try {
    const doc = await _mongoDb.collection('store').findOne({ _id: key });
    return doc ? doc.data : null;
  } catch {
    return null;
  }
}

async function mongoSave(key, data) {
  if (!_mongoDb) return;
  try {
    await _mongoDb.collection('store').updateOne(
      { _id: key },
      { $set: { data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[DB] MongoDB write error (${key}):`, err.message);
  }
}

// ── Core read / write ─────────────────────────────────────────────────────────

function readMem(key) {
  if (_mem[key] === undefined) {
    const { file, fallback } = STORE_KEYS[key];
    try {
      _mem[key] = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : JSON.parse(JSON.stringify(fallback));
    } catch {
      _mem[key] = JSON.parse(JSON.stringify(fallback));
    }
  }
  return _mem[key];
}

function writeMem(key, data) {
  _mem[key] = data;

  // Keep JSON file in sync (fast, synchronous fallback)
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_KEYS[key].file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[DB] JSON write error (${key}):`, err.message);
  }

  // Persist to MongoDB asynchronously — never blocks the caller
  mongoSave(key, data).catch(() => {});
}

// ── initialize ────────────────────────────────────────────────────────────────

async function initialize() {
  // Ensure data directory and JSON files exist (cold-start / JSON fallback)
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const key of Object.keys(STORE_KEYS)) {
    readMem(key); // populates _mem from JSON if present
  }

  // Connect to MongoDB
  const connected = await mongoConnect();
  if (!connected) {
    console.log('[DB] Running with JSON file storage');
    return;
  }

  // Sync: for each key, prefer MongoDB data if it exists; otherwise seed MongoDB
  // from existing JSON so data is never lost on first migration.
  for (const key of Object.keys(STORE_KEYS)) {
    const mongoData = await mongoLoad(key);
    if (mongoData !== null) {
      // MongoDB has data → use it (overwrites JSON cache)
      _mem[key] = mongoData;
      try {
        fs.writeFileSync(STORE_KEYS[key].file, JSON.stringify(mongoData, null, 2));
      } catch {}
    } else {
      // MongoDB is empty for this key → seed it from JSON / defaults
      await mongoSave(key, _mem[key]);
    }
  }

  console.log('[DB] MongoDB sync complete — all collections loaded');
}

// ── coins ─────────────────────────────────────────────────────────────────────
const COIN_LOG_LIMIT = 50;

function getCoins() {
  const data = readMem('coins');
  if (typeof data.balance !== 'number') data.balance = 20;
  if (typeof data.totalSpent !== 'number') data.totalSpent = 0;
  if (!Array.isArray(data.history)) data.history = [];
  return data;
}

function addCoins(amount, note) {
  const data = getCoins();
  data.balance += amount;
  data.history.unshift({ type: 'add', amount, note: note || 'Top-up', ts: Date.now() });
  if (data.history.length > COIN_LOG_LIMIT) data.history = data.history.slice(0, COIN_LOG_LIMIT);
  writeMem('coins', data);
  console.log(`[COINS] +${amount} coins added. Balance: ${data.balance}`);
  return data.balance;
}

function spendCoins(amount, note) {
  const data = getCoins();
  if (data.balance <= 0) return 0;
  const spent = Math.min(amount, data.balance);
  data.balance = Math.max(0, data.balance - amount);
  data.totalSpent += spent;
  data.history.unshift({ type: 'spend', amount: spent, note: note || 'Command', ts: Date.now() });
  if (data.history.length > COIN_LOG_LIMIT) data.history = data.history.slice(0, COIN_LOG_LIMIT);
  writeMem('coins', data);
  return data.balance;
}

function setCoins(amount) {
  const data = getCoins();
  data.balance = Math.max(0, amount);
  data.history.unshift({ type: 'set', amount, note: 'Manual set', ts: Date.now() });
  if (data.history.length > COIN_LOG_LIMIT) data.history = data.history.slice(0, COIN_LOG_LIMIT);
  writeMem('coins', data);
  return data.balance;
}

function getDailyRefill() {
  const data = getCoins();
  return {
    enabled:        data.dailyRefillEnabled !== false,
    amount:         typeof data.dailyRefillAmount === 'number' ? data.dailyRefillAmount : 100,
    lastRefillDate: data.lastRefillDate || null,
  };
}

function setDailyRefill(enabled, amount) {
  const data = getCoins();
  data.dailyRefillEnabled = enabled;
  data.dailyRefillAmount  = Math.max(1, Math.min(10000000, parseInt(amount) || 100));
  writeMem('coins', data);
  return getDailyRefill();
}

function checkAndApplyDailyRefill() {
  const data = getCoins();
  if (data.dailyRefillEnabled === false) return null;
  const amount = typeof data.dailyRefillAmount === 'number' ? data.dailyRefillAmount : 100;
  const today  = new Date().toISOString().slice(0, 10);
  if (data.lastRefillDate === today) return null;
  data.balance += amount;
  data.lastRefillDate = today;
  data.history.unshift({ type: 'refill', amount, note: `Daily auto-refill (${today})`, ts: Date.now() });
  if (data.history.length > COIN_LOG_LIMIT) data.history = data.history.slice(0, COIN_LOG_LIMIT);
  writeMem('coins', data);
  console.log(`[COINS] Daily auto-refill: +${amount} coins. Balance: ${data.balance}`);
  return data.balance;
}

// ── confessions ───────────────────────────────────────────────────────────────

function addConfession(confession) {
  const list = readMem('confessions');
  list.push(confession);
  writeMem('confessions', list);
  return confession;
}

function getConfessions() { return readMem('confessions'); }

function removeConfession(id) {
  writeMem('confessions', readMem('confessions').filter(c => c.id !== id));
}

function getConfession(id) {
  return readMem('confessions').find(c => c.id === id) || null;
}

// ── schedules ─────────────────────────────────────────────────────────────────

function addSchedule(schedule) {
  const list = readMem('schedules');
  list.push(schedule);
  writeMem('schedules', list);
}

function getSchedules() { return readMem('schedules'); }

function removeSchedule(id) {
  writeMem('schedules', readMem('schedules').filter(s => s.id !== id));
}

function removeSchedulesBefore(timestamp) {
  const list = readMem('schedules').filter(s => s.sendAt > timestamp);
  writeMem('schedules', list);
  return list;
}

// ── settings ──────────────────────────────────────────────────────────────────

const SETTING_DEFAULTS = {
  autoViewStatus: false, autoReactStatus: false, autoReactEmoji: '🔥',
  autoStatusReply: false, autoStatusReplyMsg: 'Nice status! 🔥',
  autoReply: false, autoReplyMode: 'all',
  autoReplyMsg: '~ Hello! I am currently unavailable. I will get back to you soon.',
  aiChatbot: false, aiChatbotMode: 'dm', aiChatbotPersona: '', aiChatOpener: '', aiChatTargets: [],
  antiDelete: false, antiEdit: false, antiDeleteStatus: false,
  awayMode: false,
  awayMsg: '~ Hey! I\'m currently offline/unavailable. I\'ll get back to you as soon as I\'m back. ~',
};

function getBotSetting(key) {
  const s = readMem('settings');
  return key in s ? s[key] : SETTING_DEFAULTS[key];
}

function setBotSetting(key, value) {
  const s = readMem('settings');
  s[key] = value;
  writeMem('settings', s);
}

function getAllSettings() {
  return { ...SETTING_DEFAULTS, ...readMem('settings') };
}

// ── groups ────────────────────────────────────────────────────────────────────

const GROUP_DEFAULTS = {
  antilink: 0, welcome: 0, goodbye: 0, muted: 0,
  anticall: 0, antidelete: 0, antiedit: 0, antibot: 0, antiforeign: 0,
  antibadword: 0, antiban: 0,
  welcomeMsg: '', goodbyeMsg: '',
  badwords: [],
};

function getGroup(jid) {
  const groups = readMem('groups');
  return { ...GROUP_DEFAULTS, jid, ...(groups[jid] || {}) };
}

function setGroup(jid, data) {
  const groups = readMem('groups');
  groups[jid]  = { ...GROUP_DEFAULTS, jid, ...(groups[jid] || {}), ...data };
  writeMem('groups', groups);
}

function getAllGroups() { return Object.values(readMem('groups')); }

// ── users ─────────────────────────────────────────────────────────────────────

function getUser(jid) {
  const users = readMem('users');
  return users[jid] || { jid, banned: 0 };
}

function setUser(jid, data) {
  const users = readMem('users');
  users[jid]  = { ...(users[jid] || { jid, banned: 0 }), ...data };
  writeMem('users', users);
}

// ── warns ─────────────────────────────────────────────────────────────────────

function getWarn(groupJid, userJid) {
  const warns = readMem('warns');
  return (warns[groupJid] && warns[groupJid][userJid]) || 0;
}

function addWarn(groupJid, userJid) {
  const warns = readMem('warns');
  if (!warns[groupJid]) warns[groupJid] = {};
  warns[groupJid][userJid] = (warns[groupJid][userJid] || 0) + 1;
  writeMem('warns', warns);
  return warns[groupJid][userJid];
}

function resetWarn(groupJid, userJid) {
  const warns = readMem('warns');
  if (warns[groupJid]) delete warns[groupJid][userJid];
  writeMem('warns', warns);
}

function listWarns(groupJid) {
  return readMem('warns')[groupJid] || {};
}

// ── trivia ────────────────────────────────────────────────────────────────────

function setTrivia(jid, question, answer) {
  const trivia  = readMem('trivia');
  trivia[jid]   = { question, answer, expires: Date.now() + 60000 };
  writeMem('trivia', trivia);
}

function getTrivia(jid) {
  const trivia = readMem('trivia');
  const row    = trivia[jid];
  if (!row) return null;
  if (row.expires < Date.now()) {
    delete trivia[jid];
    writeMem('trivia', trivia);
    return null;
  }
  return row;
}

function clearTrivia(jid) {
  const trivia = readMem('trivia');
  delete trivia[jid];
  writeMem('trivia', trivia);
}

// ── bad words ─────────────────────────────────────────────────────────────────

function addBadWord(jid, word) {
  const grp  = getGroup(jid);
  const list = grp.badwords || [];
  const w    = word.toLowerCase().trim();
  if (!list.includes(w)) { list.push(w); setGroup(jid, { badwords: list }); }
  return list;
}

function removeBadWord(jid, word) {
  const grp  = getGroup(jid);
  const w    = word.toLowerCase().trim();
  const list = (grp.badwords || []).filter(b => b !== w);
  setGroup(jid, { badwords: list });
  return list;
}

function getBadWords(jid) { return getGroup(jid).badwords || []; }

// ── status analytics ──────────────────────────────────────────────────────────

function recordStatusReact(posterJid, emoji, statusType) {
  const stats = readMem('statusstats');
  if (!stats[posterJid]) stats[posterJid] = { total: 0, text: 0, image: 0, video: 0, emojis: {}, lastSeen: null };
  const entry = stats[posterJid];
  entry.total = (entry.total || 0) + 1;
  const typeKey = statusType === 'imageMessage' ? 'image' : statusType === 'videoMessage' ? 'video' : 'text';
  entry[typeKey] = (entry[typeKey] || 0) + 1;
  entry.emojis[emoji] = (entry.emojis[emoji] || 0) + 1;
  entry.lastSeen = Date.now();
  writeMem('statusstats', stats);
}

function getStatusAnalytics()  { return readMem('statusstats'); }
function clearStatusAnalytics() { writeMem('statusstats', {}); }

// ── ai chat targets ───────────────────────────────────────────────────────────

function getAiChatTargets()       { return getBotSetting('aiChatTargets') || []; }

function addAiChatTarget(jid) {
  const list = getAiChatTargets();
  if (!list.includes(jid)) { list.push(jid); setBotSetting('aiChatTargets', list); }
  return list;
}

function removeAiChatTarget(jid) {
  const list = getAiChatTargets().filter(j => j !== jid);
  setBotSetting('aiChatTargets', list);
  return list;
}

function clearAiChatTargets() { setBotSetting('aiChatTargets', []); }

// ── broadcast list ────────────────────────────────────────────────────────────

function getBroadcastList() { return readMem('broadcast'); }

function addToBroadcast(jid) {
  const list = getBroadcastList();
  if (!list.includes(jid)) { list.push(jid); writeMem('broadcast', list); }
  return list;
}

function removeFromBroadcast(jid) {
  const list = getBroadcastList().filter(j => j !== jid);
  writeMem('broadcast', list);
  return list;
}

function clearBroadcast() { writeMem('broadcast', []); }

// ── activation tokens ─────────────────────────────────────────────────────────

const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/1/I/O/L

function generateTokenString() {
  const bytes = crypto.randomBytes(16);
  let raw = '';
  for (const byte of bytes) raw += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

function createActivationToken(phone, userId) {
  const tokens    = readMem('tokens');
  const token     = generateTokenString();
  const now       = new Date();
  // Tokens are permanent licences — expiresAt is set only after payment.
  // Status lifecycle: inactive → active → expired / suspended
  tokens[token]   = {
    token,
    phone,
    userId:      userId || crypto.randomUUID(),
    status:      'inactive',   // inactive | active | expired | suspended
    plan:        null,
    paymentRef:  null,
    activatedAt: null,
    expiresAt:   null,
    sessionId:   null,
    createdAt:   now.toISOString(),
  };
  writeMem('tokens', tokens);
  return tokens[token];
}

function getActivationToken(token) {
  return readMem('tokens')[token] || null;
}

function markActivationTokenUsed(token) {
  const tokens = readMem('tokens');
  if (!tokens[token]) return null;
  tokens[token].status = 'used';
  tokens[token].usedAt = new Date().toISOString();
  writeMem('tokens', tokens);
  return tokens[token];
}

function getAllActivationTokens() { return Object.values(readMem('tokens')); }

function updateActivationToken(token, updates) {
  const tokens = readMem('tokens');
  if (!tokens[token]) return null;
  Object.assign(tokens[token], updates);
  writeMem('tokens', tokens);
  return tokens[token];
}

// ── payments ──────────────────────────────────────────────────────────────────

function createPayment(checkoutRequestId, { token, plan, phone, amount }) {
  const payments = readMem('payments');
  payments[checkoutRequestId] = {
    checkoutRequestId,
    token,
    plan,
    phone,
    amount,
    status: 'pending',     // pending | confirmed | failed | cancelled
    mpesaReceiptNumber: null,
    resultCode: null,
    resultDesc: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeMem('payments', payments);
  return payments[checkoutRequestId];
}

function updatePayment(checkoutRequestId, updates) {
  const payments = readMem('payments');
  if (!payments[checkoutRequestId]) return null;
  Object.assign(payments[checkoutRequestId], { ...updates, updatedAt: new Date().toISOString() });
  writeMem('payments', payments);
  return payments[checkoutRequestId];
}

function getPayment(checkoutRequestId) {
  return readMem('payments')[checkoutRequestId] || null;
}

// ── exports ───────────────────────────────────────────────────────────────────

module.exports = {
  initialize,
  getGroup, setGroup, getAllGroups,
  getUser, setUser,
  getWarn, addWarn, resetWarn, listWarns,
  setTrivia, getTrivia, clearTrivia,
  getBotSetting, setBotSetting, getAllSettings,
  addBadWord, removeBadWord, getBadWords,
  addSchedule, getSchedules, removeSchedule, removeSchedulesBefore,
  addConfession, getConfessions, removeConfession, getConfession,
  getBroadcastList, addToBroadcast, removeFromBroadcast, clearBroadcast,
  recordStatusReact, getStatusAnalytics, clearStatusAnalytics,
  getAiChatTargets, addAiChatTarget, removeAiChatTarget, clearAiChatTargets,
  getCoins, addCoins, spendCoins, setCoins,
  getDailyRefill, setDailyRefill, checkAndApplyDailyRefill,
  createActivationToken, getActivationToken, markActivationTokenUsed, getAllActivationTokens, updateActivationToken,
  createPayment, updatePayment, getPayment,
};
