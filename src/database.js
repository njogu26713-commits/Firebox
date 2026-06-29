const fs = require('fs');
const path = require('path');

const DATA_DIR          = path.join(__dirname, '../data');
const GROUPS_FILE       = path.join(DATA_DIR, 'groups.json');
const USERS_FILE        = path.join(DATA_DIR, 'users.json');
const TRIVIA_FILE       = path.join(DATA_DIR, 'trivia.json');
const WARNS_FILE        = path.join(DATA_DIR, 'warns.json');
const SETTINGS_FILE     = path.join(DATA_DIR, 'settings.json');
const SCHEDULES_FILE    = path.join(DATA_DIR, 'schedules.json');
const CONFESSIONS_FILE  = path.join(DATA_DIR, 'confessions.json');
const BROADCAST_FILE    = path.join(DATA_DIR, 'broadcast.json');
const STATUS_STATS_FILE = path.join(DATA_DIR, 'statusstats.json');
const COINS_FILE        = path.join(DATA_DIR, 'coins.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function initialize() {
  ensureDir();
  if (!fs.existsSync(GROUPS_FILE))      writeJson(GROUPS_FILE, {});
  if (!fs.existsSync(USERS_FILE))       writeJson(USERS_FILE, {});
  if (!fs.existsSync(TRIVIA_FILE))      writeJson(TRIVIA_FILE, {});
  if (!fs.existsSync(WARNS_FILE))       writeJson(WARNS_FILE, {});
  if (!fs.existsSync(SETTINGS_FILE))    writeJson(SETTINGS_FILE, {});
  if (!fs.existsSync(SCHEDULES_FILE))   writeJson(SCHEDULES_FILE, []);
  if (!fs.existsSync(CONFESSIONS_FILE)) writeJson(CONFESSIONS_FILE, []);
  if (!fs.existsSync(BROADCAST_FILE))  writeJson(BROADCAST_FILE, []);
  if (!fs.existsSync(STATUS_STATS_FILE)) writeJson(STATUS_STATS_FILE, {});
  if (!fs.existsSync(COINS_FILE))       writeJson(COINS_FILE, { balance: 20, totalSpent: 0, history: [] });
  console.log('[DB] JSON database initialized');
}

// ── coins ─────────────────────────────────────────────────────────────────────
const COIN_LOG_LIMIT = 50;

function getCoins() {
  const data = readJson(COINS_FILE, { balance: 20, totalSpent: 0, history: [] });
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
  writeJson(COINS_FILE, data);
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
  writeJson(COINS_FILE, data);
  return data.balance;
}

function setCoins(amount) {
  const data = getCoins();
  data.balance = Math.max(0, amount);
  data.history.unshift({ type: 'set', amount, note: 'Manual set', ts: Date.now() });
  if (data.history.length > COIN_LOG_LIMIT) data.history = data.history.slice(0, COIN_LOG_LIMIT);
  writeJson(COINS_FILE, data);
  return data.balance;
}

function addConfession(confession) {
  const list = readJson(CONFESSIONS_FILE, []);
  list.push(confession);
  writeJson(CONFESSIONS_FILE, list);
  return confession;
}

function getConfessions() {
  return readJson(CONFESSIONS_FILE, []);
}

function removeConfession(id) {
  const list = readJson(CONFESSIONS_FILE, []).filter(c => c.id !== id);
  writeJson(CONFESSIONS_FILE, list);
}

function getConfession(id) {
  return readJson(CONFESSIONS_FILE, []).find(c => c.id === id) || null;
}

function addSchedule(schedule) {
  const list = readJson(SCHEDULES_FILE, []);
  list.push(schedule);
  writeJson(SCHEDULES_FILE, list);
}

function getSchedules() {
  return readJson(SCHEDULES_FILE, []);
}

function removeSchedule(id) {
  const list = readJson(SCHEDULES_FILE, []).filter(s => s.id !== id);
  writeJson(SCHEDULES_FILE, list);
}

function removeSchedulesBefore(timestamp) {
  const list = readJson(SCHEDULES_FILE, []).filter(s => s.sendAt > timestamp);
  writeJson(SCHEDULES_FILE, list);
  return list;
}

const SETTING_DEFAULTS = { autoViewStatus: false, autoReactStatus: false, autoReactEmoji: '🔥', autoStatusReply: false, autoStatusReplyMsg: 'Nice status! 🔥', autoReply: false, autoReplyMode: 'all', autoReplyMsg: '👋 Hello! I am currently unavailable. I will get back to you soon.', aiChatbot: false, aiChatbotMode: 'dm', aiChatbotPersona: '', aiChatOpener: '', aiChatTargets: [], antiDelete: false, antiEdit: false, antiDeleteStatus: false, awayMode: false, awayMsg: '👋 Hey! I\'m currently offline/unavailable. I\'ll get back to you as soon as I\'m back. 🙏' };

function getBotSetting(key) {
  const s = readJson(SETTINGS_FILE);
  return key in s ? s[key] : SETTING_DEFAULTS[key];
}

function setBotSetting(key, value) {
  const s = readJson(SETTINGS_FILE);
  s[key] = value;
  writeJson(SETTINGS_FILE, s);
}

const GROUP_DEFAULTS = {
  antilink: 0, welcome: 0, muted: 0,
  anticall: 0, antidelete: 0, antiedit: 0, antibot: 0, antiforeign: 0,
  antibadword: 0, antiban: 0,
  welcomeMsg: '', goodbyeMsg: '',
  badwords: []
};

function getGroup(jid) {
  const groups = readJson(GROUPS_FILE);
  return { ...GROUP_DEFAULTS, jid, ...(groups[jid] || {}) };
}

function setGroup(jid, data) {
  const groups = readJson(GROUPS_FILE);
  groups[jid] = { ...GROUP_DEFAULTS, jid, ...(groups[jid] || {}), ...data };
  writeJson(GROUPS_FILE, groups);
}

function getAllGroups() {
  return Object.values(readJson(GROUPS_FILE));
}

function getUser(jid) {
  const users = readJson(USERS_FILE);
  return users[jid] || { jid, banned: 0 };
}

function setUser(jid, data) {
  const users = readJson(USERS_FILE);
  users[jid] = { ...(users[jid] || { jid, banned: 0 }), ...data };
  writeJson(USERS_FILE, users);
}

// Warns: stored per group per user — warns[groupJid][userJid] = count
function getWarn(groupJid, userJid) {
  const warns = readJson(WARNS_FILE);
  return (warns[groupJid] && warns[groupJid][userJid]) || 0;
}

function addWarn(groupJid, userJid) {
  const warns = readJson(WARNS_FILE);
  if (!warns[groupJid]) warns[groupJid] = {};
  warns[groupJid][userJid] = (warns[groupJid][userJid] || 0) + 1;
  writeJson(WARNS_FILE, warns);
  return warns[groupJid][userJid];
}

function resetWarn(groupJid, userJid) {
  const warns = readJson(WARNS_FILE);
  if (warns[groupJid]) delete warns[groupJid][userJid];
  writeJson(WARNS_FILE, warns);
}

function listWarns(groupJid) {
  const warns = readJson(WARNS_FILE);
  return warns[groupJid] || {};
}

function setTrivia(jid, question, answer) {
  const trivia = readJson(TRIVIA_FILE);
  trivia[jid] = { question, answer, expires: Date.now() + 60000 };
  writeJson(TRIVIA_FILE, trivia);
}

function getTrivia(jid) {
  const trivia = readJson(TRIVIA_FILE);
  const row = trivia[jid];
  if (!row) return null;
  if (row.expires < Date.now()) {
    delete trivia[jid];
    writeJson(TRIVIA_FILE, trivia);
    return null;
  }
  return row;
}

function clearTrivia(jid) {
  const trivia = readJson(TRIVIA_FILE);
  delete trivia[jid];
  writeJson(TRIVIA_FILE, trivia);
}

function addBadWord(jid, word) {
  const grp = getGroup(jid);
  const list = grp.badwords || [];
  const w = word.toLowerCase().trim();
  if (!list.includes(w)) {
    list.push(w);
    setGroup(jid, { badwords: list });
  }
  return list;
}

function removeBadWord(jid, word) {
  const grp = getGroup(jid);
  const w = word.toLowerCase().trim();
  const list = (grp.badwords || []).filter(b => b !== w);
  setGroup(jid, { badwords: list });
  return list;
}

function getBadWords(jid) {
  return getGroup(jid).badwords || [];
}

// ── status analytics ──────────────────────────────────────────────────────────
function recordStatusReact(posterJid, emoji, statusType) {
  const stats = readJson(STATUS_STATS_FILE, {});
  if (!stats[posterJid]) stats[posterJid] = { total: 0, text: 0, image: 0, video: 0, emojis: {}, lastSeen: null };
  const entry = stats[posterJid];
  entry.total = (entry.total || 0) + 1;
  const typeKey = statusType === 'imageMessage' ? 'image' : statusType === 'videoMessage' ? 'video' : 'text';
  entry[typeKey] = (entry[typeKey] || 0) + 1;
  entry.emojis[emoji] = (entry.emojis[emoji] || 0) + 1;
  entry.lastSeen = Date.now();
  writeJson(STATUS_STATS_FILE, stats);
}

function getStatusAnalytics() {
  return readJson(STATUS_STATS_FILE, {});
}

function clearStatusAnalytics() {
  writeJson(STATUS_STATS_FILE, {});
}

// ── aichat targets ───────────────────────────────────────────────────────────
function getAiChatTargets() {
  return getBotSetting('aiChatTargets') || [];
}

function addAiChatTarget(jid) {
  const list = getAiChatTargets();
  if (!list.includes(jid)) {
    list.push(jid);
    setBotSetting('aiChatTargets', list);
  }
  return list;
}

function removeAiChatTarget(jid) {
  const list = getAiChatTargets().filter(j => j !== jid);
  setBotSetting('aiChatTargets', list);
  return list;
}

function clearAiChatTargets() {
  setBotSetting('aiChatTargets', []);
}

// ── broadcast list ────────────────────────────────────────────────────────────
function getBroadcastList() {
  return readJson(BROADCAST_FILE, []);
}

function addToBroadcast(jid) {
  const list = getBroadcastList();
  if (!list.includes(jid)) {
    list.push(jid);
    writeJson(BROADCAST_FILE, list);
  }
  return list;
}

function removeFromBroadcast(jid) {
  const list = getBroadcastList().filter(j => j !== jid);
  writeJson(BROADCAST_FILE, list);
  return list;
}

function clearBroadcast() {
  writeJson(BROADCAST_FILE, []);
}

module.exports = {
  initialize,
  getGroup, setGroup, getAllGroups,
  getUser, setUser,
  getWarn, addWarn, resetWarn, listWarns,
  setTrivia, getTrivia, clearTrivia,
  getBotSetting, setBotSetting,
  addBadWord, removeBadWord, getBadWords,
  addSchedule, getSchedules, removeSchedule, removeSchedulesBefore,
  addConfession, getConfessions, removeConfession, getConfession,
  getBroadcastList, addToBroadcast, removeFromBroadcast, clearBroadcast,
  recordStatusReact, getStatusAnalytics, clearStatusAnalytics,
  getAiChatTargets, addAiChatTarget, removeAiChatTarget, clearAiChatTargets,
  getCoins, addCoins, spendCoins, setCoins
};
