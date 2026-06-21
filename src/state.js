function createSessionState(id, name) {
  return {
    id,
    name: name || `Session ${id.slice(-4)}`,
    createdAt: Date.now(),
    status: 'disconnected',
    number: null,
    startTime: Date.now(),
    messageCount: 0,
    commandCount: 0,
    recentActivity: [],
    qr: null,
    sock: null,
    pairingCode: null,
    viewOnceCache: new Map(),
    aiChatHistory: new Map(),
    pendingPrompts: new Map(),
    messageCache: new Map(),  // id → { body, type, sender, from, ts, media }
    statusCache: new Map(),   // id → { mType, poster, ts, msg } for antideletestatus
    awayReplied: new Map(),   // jid → timestamp, throttles away auto-replies (5 min cooldown)
    awayMode: false,          // per-session away toggle
    awayMsg: '👋 Hey! I\'m currently offline/unavailable. I\'ll get back to you as soon as I\'m back. 🙏'
  };
}

function addActivity(sessionState, type, detail) {
  sessionState.recentActivity.unshift({ type, detail, time: new Date().toISOString() });
  if (sessionState.recentActivity.length > 50) sessionState.recentActivity.pop();
}

module.exports = { createSessionState, addActivity };
