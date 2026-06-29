const db = require('../database');

async function send(sock, from, msg, text) {
  const lines = text.split('\n');
  if (/\*[^*\n]+\*/.test(lines[0])) lines[0] = '> ' + lines[0];
  await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: msg });
}

function isOwnerCheck(ctx) {
  return ctx.sender === (process.env.OWNER_NUMBER || '') + '@s.whatsapp.net' || ctx.isOwner;
}

async function deleteMsg(ctx) {
  const { sock, from, msg } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  if (!quoted?.stanzaId) return send(sock, from, msg, '❌ Reply to the message you want to delete!');
  try {
    await sock.sendMessage(from, {
      delete: {
        remoteJid: from,
        fromMe: false,
        id: quoted.stanzaId,
        participant: quoted.participant
      }
    });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to delete: ${err.message}`);
  }
}

async function block(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Mention or reply to a user to block!');
  try {
    await sock.updateBlockStatus(target, 'block');
    await send(sock, from, msg, `🚫 @${target.split('@')[0]} has been blocked!`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to block: ${err.message}`);
  }
}

async function unblock(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Mention or reply to a user to unblock!');
  try {
    await sock.updateBlockStatus(target, 'unblock');
    await send(sock, from, msg, `✅ @${target.split('@')[0]} has been unblocked!`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to unblock: ${err.message}`);
  }
}

async function restart(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  await send(sock, from, msg, '🔄 Restarting Firebox...');
  setTimeout(() => process.exit(0), 1000);
}

async function react(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '😀 *Usage:* .react <emoji>\nExample: .react 🔥');
  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  const targetKey = quoted?.stanzaId
    ? { remoteJid: from, id: quoted.stanzaId, participant: quoted.participant }
    : msg.key;
  try {
    await sock.sendMessage(from, {
      react: { text: text.trim(), key: targetKey }
    });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to react: ${err.message}`);
  }
}

async function setprefix(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text || text.length > 3) return send(sock, from, msg, '❌ Usage: .setprefix <symbol>\nExample: .setprefix !');
  process.env.PREFIX = text.trim();
  await send(sock, from, msg, `✅ Prefix changed to *${text.trim()}*\n\n_Note: This resets on restart. Edit the .env file to make it permanent._`);
}

async function forward(ctx) {
  const { sock, from, msg, args } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return send(sock, from, msg, '❌ Reply to the message you want to forward!');
  if (!args[0]) return send(sock, from, msg, '❌ Usage: .forward <number>\nExample: .forward 254712345678');
  const target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  try {
    await sock.sendMessage(target, { forward: { key: { remoteJid: from, id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId }, message: quoted } });
    await send(sock, from, msg, `✅ Message forwarded!`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to forward: ${err.message}`);
  }
}

async function join(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .join <invite link>');
  try {
    const code = text.split('https://chat.whatsapp.com/').pop();
    await sock.groupAcceptInvite(code);
    await send(sock, from, msg, `✅ Joined the group!`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to join: ${err.message}`);
  }
}

async function leave(ctx) {
  const { sock, from, msg, isGroup } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!isGroup) return send(sock, from, msg, '❌ Use this in a group!');
  await send(sock, from, msg, '👋 Leaving this group...');
  try {
    await sock.groupLeave(from);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed: ${err.message}`);
  }
}

async function setbio(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .setbio <new bio>');
  try {
    await sock.updateProfileStatus(text);
    await send(sock, from, msg, `✅ Bio updated to: "${text}"`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to update bio: ${err.message}`);
  }
}

function parseDelay(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return num * ms;
}

function formatCountdown(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

async function schedule(ctx) {
  const { sock, from, msg, args, text } = ctx;
  if (args.length < 2) return send(sock, from, msg,
    '⏰ *Usage:* .schedule <delay> <message>\n\n' +
    '*Delay formats:*\n• 30s — 30 seconds\n• 5m — 5 minutes\n• 2h — 2 hours\n• 1d — 1 day\n\n' +
    '*Example:* .schedule 10m Good morning everyone! 🌅');

  const delayStr = args[0];
  const delayMs = parseDelay(delayStr);
  if (!delayMs) return send(sock, from, msg, '❌ Invalid delay format. Use: 30s, 5m, 2h, 1d');

  const content = args.slice(1).join(' ');
  if (!content.trim()) return send(sock, from, msg, '❌ Please include a message to schedule.');

  const id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const sendAt = Date.now() + delayMs;

  db.addSchedule({ id, jid: from, message: content, sendAt, createdAt: Date.now() });

  await send(sock, from, msg,
    `✅ *Message Scheduled!*\n\n` +
    `🆔 ID: \`${id}\`\n` +
    `⏰ Sends in: *${formatCountdown(delayMs)}*\n` +
    `📝 Message: "${content}"\n\n` +
    `_Use .cancelschedule ${id} to cancel_`);
}

async function schedulelist(ctx) {
  const { sock, from, msg } = ctx;

  const all = db.getSchedules().filter(s => s.jid === from);
  if (!all.length) return send(sock, from, msg, '📋 No scheduled messages for this chat.');

  const now = Date.now();
  const lines = all.map((s, i) => {
    const remaining = s.sendAt - now;
    const timeStr = remaining > 0 ? `in ${formatCountdown(remaining)}` : 'sending soon...';
    return `*${i + 1}.* [${s.id}]\n⏰ ${timeStr}\n📝 "${s.message.slice(0, 50)}${s.message.length > 50 ? '...' : ''}"`;
  }).join('\n\n');

  await send(sock, from, msg, `📋 *Scheduled Messages (${all.length})*\n\n${lines}`);
}

async function cancelschedule(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!args[0]) return send(sock, from, msg, '❌ Usage: .cancelschedule <id>');

  const id = args[0];
  const all = db.getSchedules();
  const found = all.find(s => s.id === id);
  if (!found) return send(sock, from, msg, `❌ No schedule found with ID: \`${id}\``);

  db.removeSchedule(id);
  await send(sock, from, msg, `✅ Schedule \`${id}\` cancelled.`);
}

async function inbox(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const list = db.getConfessions();
  if (!list.length) return send(sock, from, msg, '📭 No confessions yet.');
  const preview = list.slice(-10).reverse().map((c, i) => {
    const date = new Date(c.receivedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
    return `*${i + 1}.* [${c.id}] — ${date}\n💬 "${c.message.slice(0, 80)}${c.message.length > 80 ? '...' : ''}"`;
  }).join('\n\n');
  await send(sock, from, msg, `📬 *Confession Inbox (${list.length} total)*\n_Showing last 10_\n\n${preview}\n\n_Use .sharecf <id> to share or .clearcf <id> to delete_`);
}

async function sharecf(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!args[0]) return send(sock, from, msg, '❌ Usage: .sharecf <confession-id>');
  const cf = db.getConfession(args[0]);
  if (!cf) return send(sock, from, msg, `❌ Confession \`${args[0]}\` not found.`);
  await sock.sendMessage(from, {
    text: `🤫 *Anonymous Confession*\n\n"${cf.message}"\n\n_Sent anonymously via Firebox Bot_`
  });
  db.removeConfession(cf.id);
  await send(sock, from, msg, `✅ Confession shared and removed from inbox.`);
}

async function clearcf(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!args[0]) return send(sock, from, msg, '❌ Usage: .clearcf <confession-id>');
  const cf = db.getConfession(args[0]);
  if (!cf) return send(sock, from, msg, `❌ Confession \`${args[0]}\` not found.`);
  db.removeConfession(cf.id);
  await send(sock, from, msg, `🗑️ Confession \`${cf.id}\` deleted.`);
}

async function tostatus(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return send(sock, from, msg, '📸 Reply to an image or video with *.tostatus* [caption]');

  const { downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys');
  const type = getContentType(quoted);

  if (!['imageMessage', 'videoMessage'].includes(type)) {
    return send(sock, from, msg, '❌ Only images and videos can be posted as a status.');
  }

  try {
    await send(sock, from, msg, '📤 Posting to status...');
    const mediaType = type === 'imageMessage' ? 'image' : 'video';
    const stream = await downloadContentFromMessage(quoted[type], mediaType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const caption = text || '';
    const payload = type === 'imageMessage'
      ? { image: buffer, caption, mimetype: 'image/jpeg' }
      : { video: buffer, caption, mimetype: 'video/mp4', gifPlayback: false };

    await sock.sendMessage('status@broadcast', payload);
    await send(sock, from, msg, `✅ *Status posted!*${caption ? `\n\n📝 Caption: "${caption}"` : ''}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to post status: ${err.message}`);
  }
}

async function broadcaststatus(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '📢 Usage: .broadcaststatus <your message>\nExample: .broadcaststatus Hello everyone! 🔥');
  try {
    await sock.sendMessage('status@broadcast', { text });
    await send(sock, from, msg, `✅ *Status posted!*\n\n📢 "${text}"`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to post status: ${err.message}`);
  }
}

async function autoviewstatus(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();
  if (!['on', 'off'].includes(arg)) return send(sock, from, msg, '👁️ Usage: .autoviewstatus on/off');
  const enabled = arg === 'on';
  db.setBotSetting('autoViewStatus', enabled);
  await send(sock, from, msg, enabled
    ? '✅ *Auto View Status: ON*\n\n👁️ I will now automatically view all statuses.'
    : '🔴 *Auto View Status: OFF*\n\n👁️ I will no longer auto-view statuses.');
}

async function autoreactstatus(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();

  if (arg === 'random') {
    db.setBotSetting('autoReactStatus', true);
    db.setBotSetting('autoReactEmoji', 'random');
    return send(sock, from, msg,
      `✅ *Auto React Status: ON (Random Mode)*\n\n🎲 I will react to each status with a different random emoji:\n🔥 ❤️ 😍 💯 🎉 😂 👏 🥳 😎 💪 🤩 ✨ 😜 🙌 💥\n\n_No two reacts will feel the same!_`);
  }

  if (!['on', 'off'].includes(arg)) {
    const current = db.getBotSetting('autoReactStatus');
    const emojiSetting = db.getBotSetting('autoReactEmoji') || '🔥';
    const displayEmoji = emojiSetting === 'random' ? '🎲 Random' : emojiSetting;
    return send(sock, from, msg,
      `💬 *Auto React Status*\n\n` +
      `*Status:* ${current ? `ON ✅` : 'OFF ❌'}\n` +
      `*Emoji:* ${displayEmoji}\n\n` +
      `*Commands:*\n` +
      `• .autoreactstatus on — enable with current emoji\n` +
      `• .autoreactstatus on ❤️ — enable with specific emoji\n` +
      `• .autoreactstatus random — enable random emoji mode 🎲\n` +
      `• .autoreactstatus off — disable`);
  }

  const enabled = arg === 'on';
  db.setBotSetting('autoReactStatus', enabled);
  if (enabled && args[1]) {
    db.setBotSetting('autoReactEmoji', args[1].trim());
  }
  const emojiSetting = db.getBotSetting('autoReactEmoji') || '🔥';
  const isRandom = emojiSetting === 'random';
  await send(sock, from, msg, enabled
    ? `✅ *Auto React Status: ON*\n\n${isRandom ? '🎲 Random emoji mode — different reaction every time!' : `${emojiSetting} I will react to every status with ${emojiSetting}`}`
    : `🔴 *Auto React Status: OFF*\n\nI will no longer react to statuses.`);
}

async function aichat(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const sub = args[0]?.toLowerCase();

  if (sub === 'off') {
    db.setBotSetting('aiChatbot', false);
    return send(sock, from, msg, '🔴 *AI Chatbot: OFF*\n\nAI will no longer reply as you.');
  }

  if (sub === 'opener') {
    const opener = args.slice(1).join(' ').trim();
    if (!opener) {
      const current = db.getBotSetting('aiChatOpener');
      return send(sock, from, msg,
        `🎯 *AI Chat Opener*\n\n` +
        `*Current:* ${current ? `"${current}"` : 'None (AI decides)'}\n\n` +
        `*Usage:* .aichat opener <first message>\n\n` +
        `*Examples:*\n` +
        `• .aichat opener Hey! 👋 What's up?\n` +
        `• .aichat opener Hii, umefika sawa? 😄\n` +
        `• .aichat opener Yoo! Long time no hear 🔥\n\n` +
        `_This is sent as the very first reply to any new contact_\n` +
        `_Use .aichat opener clear to remove it_`);
    }
    if (opener === 'clear') {
      db.setBotSetting('aiChatOpener', '');
      return send(sock, from, msg, '✅ Opener cleared. AI will generate a natural first reply.');
    }
    db.setBotSetting('aiChatOpener', opener);
    return send(sock, from, msg, `✅ *Opener set!*\n\n🎯 "${opener}"\n\n_This will be sent to every new contact who messages you_`);
  }

  if (sub === 'persona') {
    const persona = args.slice(1).join(' ').trim();
    if (!persona) return send(sock, from, msg,
      '❌ Usage: .aichat persona <describe yourself>\n\n' +
      '*Example:*\n.aichat persona I am John, a 25 year old guy from Nairobi. I am friendly, funny and I love football. I speak Swahili and English. I reply casually and use emojis sometimes.');
    db.setBotSetting('aiChatbotPersona', persona);
    return send(sock, from, msg, `✅ *Persona updated!*\n\n👤 "${persona}"\n\n_AI will now reply as you using this description._`);
  }

  if (sub === 'add') {
    const persona = db.getBotSetting('aiChatbotPersona');
    if (!persona) return send(sock, from, msg, '⚠️ Set your persona first with .aichat persona <about you>');
    const raw = args[1]?.replace(/[^0-9]/g, '');
    const isGroup = from.endsWith('@g.us');
    let targetJid;
    if (!raw && isGroup) {
      targetJid = from;
    } else if (raw) {
      targetJid = raw + '@s.whatsapp.net';
    } else {
      return send(sock, from, msg,
        '❌ Usage:\n' +
        '• `.aichat add 254712345678` — add a contact (number only)\n' +
        '• `.aichat add` (in a group) — add current group');
    }
    db.addAiChatTarget(targetJid);
    db.setBotSetting('aiChatbot', true);
    db.setBotSetting('aiChatbotMode', 'specific');
    const label = targetJid.endsWith('@g.us') ? `Group: ${targetJid.split('@')[0]}` : `+${targetJid.split('@')[0]}`;
    const total = db.getAiChatTargets().length;
    return send(sock, from, msg,
      `✅ *AI Chat enabled for:*\n📌 ${label}\n\n` +
      `🤖 Total targets: *${total}*\n` +
      `_Use .aichat list to see all — .aichat remove <number> to remove_`);
  }

  if (sub === 'remove') {
    const raw = args[1]?.replace(/[^0-9]/g, '');
    const isGroup = from.endsWith('@g.us');
    let targetJid;
    if (!raw && isGroup) {
      targetJid = from;
    } else if (raw) {
      targetJid = raw.includes('@') ? raw : raw + '@s.whatsapp.net';
    } else {
      return send(sock, from, msg, '❌ Usage: .aichat remove 254712345678');
    }
    const list = db.removeAiChatTarget(targetJid);
    if (list.length === 0) {
      db.setBotSetting('aiChatbot', false);
      return send(sock, from, msg, '🔴 *AI Chat OFF* — no targets left.\n\nUse .aichat add to add someone.');
    }
    return send(sock, from, msg, `✅ Removed. *${list.length}* target(s) remaining.\nUse .aichat list to see them.`);
  }

  if (sub === 'list') {
    const targets = db.getAiChatTargets();
    if (!targets.length) return send(sock, from, msg, '📋 *No AI chat targets set.*\n\nUse .aichat add <number> to add someone.');
    const lines = targets.map((j, i) => {
      const label = j.endsWith('@g.us') ? `👥 Group ${j.split('@')[0]}` : `👤 +${j.split('@')[0]}`;
      return `${i + 1}. ${label}`;
    }).join('\n');
    return send(sock, from, msg, `📋 *AI Chat Targets (${targets.length}):*\n\n${lines}\n\n_Use .aichat remove <number> to remove_`);
  }

  if (sub === 'clear') {
    db.clearAiChatTargets();
    db.setBotSetting('aiChatbot', false);
    return send(sock, from, msg, '🗑️ All AI chat targets cleared. AI chatbot is now OFF.');
  }

  const validModes = ['all', 'dm', 'group'];
  if (sub === 'on' || validModes.includes(sub)) {
    const persona = db.getBotSetting('aiChatbotPersona');
    if (!persona) return send(sock, from, msg,
      '⚠️ *Set your persona first!*\n\n' +
      'Use .aichat persona <describe yourself> before enabling.\n\n' +
      '*Example:*\n.aichat persona I am a 22 year old from Nairobi, friendly and funny, I love music and tech. I reply casually.');
    const mode = validModes.includes(args[1]?.toLowerCase()) ? args[1].toLowerCase()
      : validModes.includes(sub) ? sub
      : 'dm';
    db.setBotSetting('aiChatbot', true);
    db.setBotSetting('aiChatbotMode', mode);
    return send(sock, from, msg,
      `✅ *AI Chatbot: ON*\n\n` +
      `📡 Mode: *${mode.toUpperCase()}*\n` +
      `👤 Persona: "${persona}"\n\n` +
      `_AI will now reply to incoming messages as you._\n` +
      `_Use .aichat off to stop_`);
  }

  const current = db.getBotSetting('aiChatbot');
  const mode = db.getBotSetting('aiChatbotMode') || 'dm';
  const persona = db.getBotSetting('aiChatbotPersona') || 'Not set';
  const targets = db.getAiChatTargets();
  return send(sock, from, msg,
    `🤖 *AI Chatbot Settings*\n\n` +
    `*Status:* ${current ? `ON (${mode.toUpperCase()})` : 'OFF'}\n` +
    `*Persona:* "${persona}"\n` +
    `*Targets:* ${targets.length > 0 ? targets.length + ' specific' : 'none'}\n\n` +
    `*Commands:*\n` +
    `• .aichat persona <about you> — set personality\n` +
    `• .aichat add <number> — enable for specific contact\n` +
    `• .aichat add (in group) — enable for this group\n` +
    `• .aichat remove <number> — remove a target\n` +
    `• .aichat list — see all targets\n` +
    `• .aichat clear — remove all targets\n` +
    `• .aichat dm — enable for all DMs\n` +
    `• .aichat all — enable for everyone\n` +
    `• .aichat group — enable for all groups\n` +
    `• .aichat off — disable`);
}

async function autoreply(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const sub = args[0]?.toLowerCase();

  if (sub === 'off') {
    db.setBotSetting('autoReply', false);
    return send(sock, from, msg, '🔴 *Auto Reply: OFF*\n\nI will no longer auto-reply to messages.');
  }

  if (sub === 'msg') {
    const newMsg = args.slice(1).join(' ').trim();
    if (!newMsg) return send(sock, from, msg, '❌ Usage: .autoreply msg <your message>');
    db.setBotSetting('autoReplyMsg', newMsg);
    return send(sock, from, msg, `✅ *Auto Reply message updated!*\n\n💬 "${newMsg}"`);
  }

  const validModes = ['all', 'dm', 'group'];
  if (sub === 'on' || validModes.includes(sub)) {
    const mode = validModes.includes(args[1]?.toLowerCase()) ? args[1].toLowerCase()
      : validModes.includes(sub) ? sub
      : 'all';
    db.setBotSetting('autoReply', true);
    db.setBotSetting('autoReplyMode', mode);
    const replyMsg = db.getBotSetting('autoReplyMsg');
    return send(sock, from, msg,
      `✅ *Auto Reply: ON*\n\n` +
      `📡 Mode: *${mode.toUpperCase()}*\n` +
      `💬 Message: "${replyMsg}"\n\n` +
      `_Use .autoreply msg <text> to change the reply message_\n` +
      `_Use .autoreply off to disable_`);
  }

  const current = db.getBotSetting('autoReply');
  const mode = db.getBotSetting('autoReplyMode') || 'all';
  const replyMsg = db.getBotSetting('autoReplyMsg');
  return send(sock, from, msg,
    `💬 *Auto Reply Settings*\n\n` +
    `*Status:* ${current ? `ON (${mode.toUpperCase()})` : 'OFF'}\n` +
    `*Message:* "${replyMsg}"\n\n` +
    `*Usage:*\n` +
    `• .autoreply on — reply to all messages\n` +
    `• .autoreply all — reply to all\n` +
    `• .autoreply dm — DMs only\n` +
    `• .autoreply group — Groups only\n` +
    `• .autoreply msg <text> — set reply message\n` +
    `• .autoreply off — disable`);
}

async function antidelete(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();
  if (!['on', 'off'].includes(arg)) {
    const current = db.getBotSetting('antiDelete');
    return send(sock, from, msg,
      `🗑️ *Anti-Delete*\n\n` +
      `*Usage:* .antidelete on/off\n\n` +
      `*Current:* ${current ? 'ON ✅' : 'OFF ❌'}\n\n` +
      `_When ON, any deleted message (in groups OR DMs) is forwarded to your DM._`);
  }
  const enabled = arg === 'on';
  db.setBotSetting('antiDelete', enabled);
  await send(sock, from, msg, enabled
    ? `🗑️ *Anti-Delete: ON ✅*\n\n_Deleted messages from ALL chats will be forwarded to your DM._`
    : `🔴 *Anti-Delete: OFF ❌*\n\n_Deleted messages will no longer be forwarded._`);
}

async function antiedit(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();
  if (!['on', 'off'].includes(arg)) {
    const current = db.getBotSetting('antiEdit');
    return send(sock, from, msg,
      `✏️ *Anti-Edit*\n\n` +
      `*Usage:* .antiedit on/off\n\n` +
      `*Current:* ${current ? 'ON ✅' : 'OFF ❌'}\n\n` +
      `_When ON, any edited message (in groups OR DMs) is forwarded to your DM with the original text._`);
  }
  const enabled = arg === 'on';
  db.setBotSetting('antiEdit', enabled);
  await send(sock, from, msg, enabled
    ? `✏️ *Anti-Edit: ON ✅*\n\n_Edited messages from ALL chats will be forwarded to your DM with the original content._`
    : `🔴 *Anti-Edit: OFF ❌*\n\n_Edited messages will no longer be tracked._`);
}

async function antideletestatus(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();
  if (!['on', 'off'].includes(arg)) {
    const current = db.getBotSetting('antiDeleteStatus');
    return send(sock, from, msg,
      `🛡️ *Anti-Delete Status*\n\n` +
      `*Usage:* .antideletestatus on/off\n\n` +
      `*Current:* ${current ? 'ON ✅' : 'OFF ❌'}\n\n` +
      `_When ON, if someone deletes their WhatsApp status the bot will secretly forward it to your DM._`);
  }
  const enabled = arg === 'on';
  db.setBotSetting('antiDeleteStatus', enabled);
  await send(sock, from, msg, enabled
    ? `🛡️ *Anti-Delete Status: ON ✅*\n\n_If anyone deletes their status, I will forward it to your DM silently._`
    : `🔴 *Anti-Delete Status: OFF ❌*\n\n_I will no longer track deleted statuses._`);
}

async function autostatusreply(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();

  // Set custom reply per status type
  if (arg === 'text') {
    const custom = args.slice(1).join(' ').trim();
    if (!custom) return send(sock, from, msg, '❌ Usage: .autostatusreply text <message>\nExample: .autostatusreply text Facts! 💯');
    db.setBotSetting('autoStatusReplyMsg', custom);
    return send(sock, from, msg, `✅ *Text status reply set!*\n\n📝 "${custom}"\n\n_Bot will send this when someone posts a text status_`);
  }
  if (arg === 'img' || arg === 'image' || arg === 'photo') {
    const custom = args.slice(1).join(' ').trim();
    if (!custom) return send(sock, from, msg, '❌ Usage: .autostatusreply img <message>\nExample: .autostatusreply img Fire pic! 😍');
    db.setBotSetting('autoStatusReplyImg', custom);
    return send(sock, from, msg, `✅ *Image status reply set!*\n\n📸 "${custom}"\n\n_Bot will send this when someone posts an image status_`);
  }
  if (arg === 'video' || arg === 'vid') {
    const custom = args.slice(1).join(' ').trim();
    if (!custom) return send(sock, from, msg, '❌ Usage: .autostatusreply video <message>\nExample: .autostatusreply video Banger vid! 🎬');
    db.setBotSetting('autoStatusReplyVideo', custom);
    return send(sock, from, msg, `✅ *Video status reply set!*\n\n🎬 "${custom}"\n\n_Bot will send this when someone posts a video status_`);
  }
  if (arg === 'reset') {
    db.setBotSetting('autoStatusReplyMsg', '');
    db.setBotSetting('autoStatusReplyImg', '');
    db.setBotSetting('autoStatusReplyVideo', '');
    return send(sock, from, msg, '🔄 *All status replies reset to random defaults.*');
  }

  if (!['on', 'off'].includes(arg)) {
    const current = db.getBotSetting('autoStatusReply');
    const textMsg  = db.getBotSetting('autoStatusReplyMsg')   || '_(random)_';
    const imgMsg   = db.getBotSetting('autoStatusReplyImg')    || '_(random)_';
    const videoMsg = db.getBotSetting('autoStatusReplyVideo')  || '_(random)_';
    return send(sock, from, msg,
      `💬 *Auto Status Reply*\n\n` +
      `*Status:* ${current ? 'ON ✅' : 'OFF ❌'}\n\n` +
      `📝 *Text:* "${textMsg}"\n` +
      `📸 *Image:* "${imgMsg}"\n` +
      `🎬 *Video:* "${videoMsg}"\n\n` +
      `*Commands:*\n` +
      `• .autostatusreply on — enable\n` +
      `• .autostatusreply off — disable\n` +
      `• .autostatusreply text <msg> — set text status reply\n` +
      `• .autostatusreply img <msg> — set image status reply\n` +
      `• .autostatusreply video <msg> — set video status reply\n` +
      `• .autostatusreply reset — back to random replies\n\n` +
      `_When no custom message is set, a random reply is sent for each type_`);
  }

  const enabled = arg === 'on';
  db.setBotSetting('autoStatusReply', enabled);
  const textMsg  = db.getBotSetting('autoStatusReplyMsg')  || '(random)';
  const imgMsg   = db.getBotSetting('autoStatusReplyImg')  || '(random)';
  const videoMsg = db.getBotSetting('autoStatusReplyVideo')|| '(random)';
  await send(sock, from, msg, enabled
    ? `✅ *Auto Status Reply: ON*\n\n📝 Text: "${textMsg}"\n📸 Image: "${imgMsg}"\n🎬 Video: "${videoMsg}"\n\n_Different reply for each status type!_`
    : `🔴 *Auto Status Reply: OFF*\n\nI will no longer reply to statuses.`);
}

// ── BROADCAST LIST ────────────────────────────────────────────────────────────

function normaliseJid(raw) {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? digits + '@s.whatsapp.net' : null;
}

async function addbc(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg,
    '📋 *Usage:* .addbc <number>\nExample: .addbc 254712345678\n\n_Add a contact to your broadcast list._');

  const jid = normaliseJid(text);
  if (!jid) return send(sock, from, msg, '❌ Invalid number.');

  const list = db.addToBroadcast(jid);
  const num  = jid.split('@')[0];
  await send(sock, from, msg,
    `✅ *+${num}* added to broadcast list.\n📋 Total contacts: *${list.length}*`);
}

async function removebc(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '📋 *Usage:* .removebc <number>');

  const jid = normaliseJid(text);
  if (!jid) return send(sock, from, msg, '❌ Invalid number.');

  const list = db.removeFromBroadcast(jid);
  const num  = jid.split('@')[0];
  await send(sock, from, msg,
    `🗑️ *+${num}* removed from broadcast list.\n📋 Remaining: *${list.length}*`);
}

async function listbc(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const list = db.getBroadcastList();
  if (list.length === 0) {
    return send(sock, from, msg,
      '📋 *Broadcast List is empty.*\n\nAdd contacts with *.addbc <number>*');
  }
  const lines = list.map((jid, i) => `  ${i + 1}. +${jid.split('@')[0]}`).join('\n');
  await send(sock, from, msg,
    `📋 *Broadcast List* (${list.length} contacts)\n\n${lines}\n\n_Use .broadcast <message> to send_`);
}

async function clearbc(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const list = db.getBroadcastList();
  if (list.length === 0) return send(sock, from, msg, '📋 Broadcast list is already empty.');

  db.clearBroadcast();
  await send(sock, from, msg, `🗑️ Broadcast list cleared. *${list.length}* contact(s) removed.`);
}

async function broadcast(ctx) {
  const { sock, from, msg, text, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const list = db.getBroadcastList();
  if (list.length === 0) {
    return send(sock, from, msg,
      '📋 *Broadcast list is empty!*\n\nAdd contacts first:\n*.addbc <number>*');
  }

  const quoted = msg.message?.extendedTextMessage?.contextInfo;
  const hasMedia = !!quoted?.quotedMessage;
  const message  = text?.trim();

  if (!message && !hasMedia) {
    return send(sock, from, msg,
      `📢 *Usage:* .broadcast <your message>\n\n` +
      `📋 You have *${list.length}* contact(s) in your list.\n\n` +
      `_Tip: You can also reply to an image/video with .broadcast <caption> to broadcast media._`);
  }

  // Confirmation with count
  await send(sock, from, msg,
    `📢 *Broadcasting to ${list.length} contact(s)...*\n⏳ Sending with a small delay to avoid bans.`);

  let sent = 0;
  let failed = 0;

  for (const jid of list) {
    try {
      if (hasMedia && quoted?.quotedMessage) {
        const qm = quoted.quotedMessage;
        const qType = Object.keys(qm)[0];

        if (qType === 'imageMessage' && qm.imageMessage?.url) {
          await sock.sendMessage(jid, {
            image: { url: qm.imageMessage.url },
            caption: message || ''
          });
        } else if (qType === 'videoMessage' && qm.videoMessage?.url) {
          await sock.sendMessage(jid, {
            video: { url: qm.videoMessage.url },
            caption: message || ''
          });
        } else if (qType === 'audioMessage' && qm.audioMessage?.url) {
          await sock.sendMessage(jid, {
            audio: { url: qm.audioMessage.url },
            mimetype: 'audio/mp4',
            ptt: qm.audioMessage.ptt || false
          });
        } else {
          // Fallback to text only
          await sock.sendMessage(jid, { text: message || '📢 Broadcast message' });
        }
      } else {
        await sock.sendMessage(jid, { text: message });
      }
      sent++;
    } catch (err) {
      console.error(`[BROADCAST] Failed for ${jid}:`, err.message);
      failed++;
    }

    // 1.5s delay between each to avoid WhatsApp rate-limiting
    if (list.indexOf(jid) < list.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  await send(sock, from, msg,
    `✅ *Broadcast complete!*\n\n` +
    `📤 Sent: *${sent}*\n` +
    `❌ Failed: *${failed}*\n` +
    `📋 Total: *${list.length}*`);
}

async function dead(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const sub = (args[0] || '').toLowerCase();
  if (!sub || (sub !== 'on' && sub !== 'off')) {
    const current = db.getBotSetting('deadMode') ? 'ON 💀' : 'OFF ✅';
    const customMsg = db.getBotSetting('deadMsg') || '_(default message)_';
    return send(sock, from, msg,
      `💀 *Bot Dead Mode*\n\nStatus: *${current}*\nMessage: ${customMsg}\n\n` +
      `*Usage:*\n` +
      `• *.dead on* — enable dead mode\n` +
      `• *.dead on <custom msg>* — enable with custom reply\n` +
      `• *.dead off* — disable dead mode\n\n` +
      `_When ON, all non-owner messages get the dead notice and commands are ignored._`
    );
  }

  if (sub === 'off') {
    db.setBotSetting('deadMode', 0);
    return send(sock, from, msg, `✅ *Dead mode disabled.* Bot is back online!`);
  }

  // sub === 'on'
  const customMsg = args.slice(1).join(' ').trim();
  if (customMsg) db.setBotSetting('deadMsg', customMsg);
  db.setBotSetting('deadMode', 1);
  const preview = customMsg || `💀 Bot is currently dead / offline.\n_Please try again later or contact the owner._`;
  await send(sock, from, msg,
    `💀 *Dead mode enabled!*\n\nReply to all messages:\n_"${preview}"_\n\n` +
    `_Send .dead off to bring the bot back online._`
  );
}

async function away(ctx) {
  const { sock, from, msg, args, sessionState } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');

  const sub = (args[0] || '').toLowerCase();
  if (!sub || (sub !== 'on' && sub !== 'off')) {
    return send(sock, from, msg,
      `🌙 *Away Mode* — ${sessionState.name}\n\n` +
      `Status: ${sessionState.awayMode ? '✅ ON' : '❌ OFF'}\n` +
      `Message: _${sessionState.awayMsg}_\n\n` +
      `*Usage:*\n` +
      `• .away on — enable with default message\n` +
      `• .away on <custom message> — set custom away message\n` +
      `• .away off — disable away mode`
    );
  }

  if (sub === 'off') {
    sessionState.awayMode = false;
    sessionState.awayReplied.clear();
    db.setBotSetting('awayMode', false);
    return send(sock, from, msg, `✅ Away mode *disabled* for *${sessionState.name}*. You're back online!`);
  }

  // sub === 'on'
  const customMsg = args.slice(1).join(' ').trim();
  if (customMsg) {
    sessionState.awayMsg = customMsg;
    db.setBotSetting('awayMsg', customMsg);
  }
  sessionState.awayMode = true;
  db.setBotSetting('awayMode', true);
  sessionState.awayReplied.clear();

  return send(sock, from, msg,
    `🌙 Away mode *enabled* for *${sessionState.name}*!\n\n` +
    `Anyone who DMs you will be told:\n_"${sessionState.awayMsg}"_`
  );
}

async function dmgroup(ctx) {
  const { sock, from, msg, text, isGroup, botNumber } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!isGroup) return send(sock, from, msg, '❌ Use this command *inside a group*.');

  let metadata;
  try { metadata = await sock.groupMetadata(from); } catch {
    return send(sock, from, msg, '❌ Could not fetch group members. Make sure I am in this group.');
  }

  const botJid = botNumber || (sock.user?.id?.split(':')[0] + '@s.whatsapp.net');
  const members = metadata.participants
    .map(p => p.id)
    .filter(id => id !== botJid && !id.endsWith('@g.us'));

  if (!members.length) return send(sock, from, msg, '❌ No members found in this group.');

  const customMsg = text?.trim();
  const defaultMsg =
    `👋 Hey! Please save my number to your contacts so you can see my *WhatsApp status* updates 🙏\n\n` +
    `_Save and you'll never miss a status!_ ✨`;
  const message = customMsg || defaultMsg;

  await send(sock, from, msg,
    `📤 *Group DM Started*\n\n` +
    `👥 Members: *${members.length}*\n` +
    `⏱️ Estimated time: ~${members.length} min\n\n` +
    `_Sending one per minute to stay safe and natural..._`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < members.length; i++) {
    const jid = members[i];
    try {
      await sock.sendMessage(jid, { text: message });
      sent++;
    } catch (err) {
      failed++;
    }
    // ~1 minute delay (55–75 seconds) between each DM — looks human, avoids bans
    if (i < members.length - 1) {
      const delay = 55000 + Math.floor(Math.random() * 20000);
      await new Promise(r => setTimeout(r, delay));
    }
    // Progress update every 5 members
    if ((i + 1) % 5 === 0 && i < members.length - 1) {
      await send(sock, from, msg,
        `⏳ Progress: *${i + 1}/${members.length}* sent...`);
    }
  }

  await send(sock, from, msg,
    `✅ *Group DM Complete!*\n\n` +
    `👥 Group: *${metadata.subject}*\n` +
    `📤 Sent: *${sent}*\n` +
    `❌ Failed: *${failed}*\n\n` +
    `_Everyone has been notified to save your number!_ 🔥`);
}

async function mode(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const arg = args[0]?.toLowerCase();
  if (!['public', 'private'].includes(arg)) {
    const current = db.getBotSetting('botMode') || 'public';
    const badge = current === 'private' ? '🔒 PRIVATE' : '🌐 PUBLIC';
    return send(sock, from, msg,
      `🤖 *Bot Mode*\n\n` +
      `*Current:* ${badge}\n\n` +
      `🌐 *Public* — anyone can use bot commands\n` +
      `🔒 *Private* — only the owner can use commands\n\n` +
      `*Usage:*\n• .mode public\n• .mode private`);
  }
  db.setBotSetting('botMode', arg);
  if (arg === 'private') {
    await send(sock, from, msg,
      `🔒 *Bot Mode: PRIVATE*\n\n` +
      `Only you (the owner) can now use bot commands.\n` +
      `Anyone else who tries will see:\n_"🔒 Bot is in private mode."_\n\n` +
      `Use *.mode public* to open it back up.`);
  } else {
    await send(sock, from, msg,
      `🌐 *Bot Mode: PUBLIC*\n\n` +
      `Everyone can now use bot commands.\n\n` +
      `Use *.mode private* to restrict to owner only.`);
  }
}

async function statusstats(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const stats = db.getStatusAnalytics();
  const entries = Object.entries(stats);
  if (!entries.length) {
    return send(sock, from, msg,
      `📊 *Status React Analytics*\n\n_No data yet. Enable auto react status and reactions will be tracked here!_\n\n💡 Tip: .autoreactstatus random`);
  }
  const sorted = entries.sort((a, b) => b[1].total - a[1].total);
  const medals = ['🥇', '🥈', '🥉'];
  let text = `📊 *Status React Analytics*\n${'─'.repeat(28)}\n\n`;
  sorted.slice(0, 10).forEach(([jid, data], i) => {
    const num = jid.split('@')[0];
    const medal = medals[i] || `${i + 1}.`;
    const topEmoji = Object.entries(data.emojis || {}).sort((a,b) => b[1]-a[1])[0];
    const lastSeen = data.lastSeen ? new Date(data.lastSeen).toLocaleDateString('en-GB', { day:'2-digit', month:'short' }) : '—';
    text += `${medal} *+${num}*\n`;
    text += `   📬 ${data.total} react${data.total !== 1 ? 's' : ''}`;
    if (topEmoji) text += `  ·  fav: ${topEmoji[0]}`;
    text += `\n`;
    const breakdown = [];
    if (data.text)  breakdown.push(`📝 ${data.text}`);
    if (data.image) breakdown.push(`📸 ${data.image}`);
    if (data.video) breakdown.push(`🎬 ${data.video}`);
    if (breakdown.length) text += `   ${breakdown.join('  ')}\n`;
    text += `   🕐 Last: ${lastSeen}\n\n`;
  });
  if (sorted.length > 10) text += `_...and ${sorted.length - 10} more contacts_\n\n`;
  text += `*Total contacts tracked:* ${sorted.length}\n*Total reacts sent:* ${sorted.reduce((s,[,d]) => s + d.total, 0)}\n\n_Use .clearstatusstats to reset_`;
  await send(sock, from, msg, text);
}

async function clearstatusstats(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  db.clearStatusAnalytics();
  await send(sock, from, msg, '🗑️ *Status react analytics cleared!*\n\n_Tracking starts fresh from now._');
}

// ─── DISK USAGE ──────────────────────────────────────────────────────────────
async function disk(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const { execSync } = require('child_process');
  const os = require('os');
  try {
    const dfOut = execSync('df -h / 2>/dev/null || df -h .', { encoding: 'utf8' }).trim();
    const lines = dfOut.split('\n');
    const data = lines[1]?.split(/\s+/) || [];
    const total = data[1] || 'N/A', used = data[2] || 'N/A', avail = data[3] || 'N/A', pct = data[4] || 'N/A';
    const tmpDu = execSync('du -sh tmp/ 2>/dev/null || echo "0 tmp"', { encoding: 'utf8', cwd: require('path').join(__dirname, '../../') }).trim().split(/\s+/)[0];
    const mem = process.memoryUsage();
    await send(sock, from, msg,
      `💾 *Disk & Memory Usage*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `📀 *Total:* ${total}\n` + `📊 *Used:* ${used} (${pct})\n` + `✅ *Free:* ${avail}\n` +
      `🗂️ *Tmp folder:* ${tmpDu}\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `💻 *RAM (process):* ${(mem.rss/1024/1024).toFixed(1)} MB\n` +
      `🔄 *Heap used:* ${(mem.heapUsed/1024/1024).toFixed(1)} MB\n` +
      `🖥️ *Free RAM (OS):* ${(os.freemem()/1024/1024).toFixed(0)} MB / ${(os.totalmem()/1024/1024).toFixed(0)} MB`
    );
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── HOST IP ─────────────────────────────────────────────────────────────────
async function hostip(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const axios = require('axios');
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    const ip = res.data.ip;
    const geo = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 8000 }).catch(() => null);
    const g = geo?.data;
    await send(sock, from, msg,
      `🌐 *Host IP Info*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🔗 *IP:* ${ip}\n` +
      `${g ? `🌍 *Country:* ${g.country_name}\n🏙️ *City:* ${g.city}\n📡 *ISP:* ${g.org}\n` : ''}`
    );
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── ONLINE/PRESENCE ─────────────────────────────────────────────────────────
async function online(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = args[0]?.toLowerCase();
  if (val === 'on') {
    db.setBotSetting('alwaysOnline', true);
    await sock.sendPresenceUpdate('available').catch(() => {});
    await send(sock, from, msg, '✅ *Always Online: ON*\n\nBot will appear online at all times.');
  } else if (val === 'off') {
    db.setBotSetting('alwaysOnline', false);
    await sock.sendPresenceUpdate('unavailable').catch(() => {});
    await send(sock, from, msg, '🔴 *Always Online: OFF*\n\nBot will show offline when idle.');
  } else {
    const current = db.getBotSetting('alwaysOnline') ? 'ON ✅' : 'OFF ❌';
    await send(sock, from, msg, `💤 *Always Online*\n\nCurrent: *${current}*\n\nUsage: .online on/off`);
  }
}

// ─── PRIVACY SETTINGS ────────────────────────────────────────────────────────
async function lastseen(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = args[0]?.toLowerCase();
  const options = { all: 'all', contacts: 'contacts', 'contact_blacklist': 'contact_blacklist', none: 'none' };
  if (!options[val]) return send(sock, from, msg, '👁️ *Last Seen Privacy*\n\nUsage: .lastseen <value>\nOptions:\n• `all` — everyone\n• `contacts` — contacts only\n• `none` — no one\n\nExample: .lastseen none');
  try {
    await sock.updateLastSeenPrivacy(options[val]);
    await send(sock, from, msg, `✅ *Last Seen:* ${val}`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function ppprivacy(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = args[0]?.toLowerCase();
  if (!['all','contacts','none'].includes(val)) return send(sock, from, msg, '🖼️ *Profile Photo Privacy*\n\nUsage: .ppprivacy <all/contacts/none>');
  try {
    await sock.updateProfilePicturePrivacy(val);
    await send(sock, from, msg, `✅ *Profile Photo Privacy:* ${val}`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function readreceipts(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = args[0]?.toLowerCase();
  if (!['on','off'].includes(val)) return send(sock, from, msg, '👁️ *Read Receipts*\n\nUsage: .readreceipts on/off\n\nOFF = others won\'t see when you read their messages (blue ticks hidden).');
  try {
    await sock.updateReadReceiptsPrivacy(val === 'on' ? 'all' : 'none');
    await send(sock, from, msg, `✅ *Read Receipts:* ${val.toUpperCase()}`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function gcaddprivacy(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = args[0]?.toLowerCase();
  if (!['all','contacts','contact_blacklist','none'].includes(val))
    return send(sock, from, msg, '👥 *Group Add Privacy*\n\nWho can add bot to groups?\nUsage: .gcaddprivacy <all/contacts/none>');
  try {
    await sock.updateGroupsAddPrivacy(val);
    await send(sock, from, msg, `✅ *Group Add Privacy:* ${val}`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── VIEW ONCE ───────────────────────────────────────────────────────────────
async function toviewonce(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.imageMessage && !quoted?.videoMessage)
    return send(sock, from, msg, '👁️ *To View Once*\n\nReply to an image or video with `.toviewonce`\nSends it as a view-once message.');
  await send(sock, from, msg, '🔄 Converting to view once...');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant }, message: quoted };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (quoted.imageMessage) {
      await sock.sendMessage(from, { image: buf, viewOnce: true, caption: '' }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { video: buf, viewOnce: true, caption: '', mimetype: 'video/mp4' }, { quoted: msg });
    }
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function vv2(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const isViewOnce = quoted?.imageMessage?.viewOnce || quoted?.videoMessage?.viewOnce || quoted?.audioMessage?.viewOnce;
  if (!isViewOnce && !quoted)
    return send(sock, from, msg, '👁️ *View Once Opener (VV2)*\n\nReply to a view-once message with `.vv2`\nThe bot will resend it as a regular message.');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant }, message: quoted };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (quoted.imageMessage) await sock.sendMessage(from, { image: buf, caption: '👁️ *View Once (opened)*', mimetype: quoted.imageMessage.mimetype || 'image/jpeg' }, { quoted: msg });
    else if (quoted.videoMessage) await sock.sendMessage(from, { video: buf, caption: '👁️ *View Once (opened)*', mimetype: 'video/mp4' }, { quoted: msg });
    else if (quoted.audioMessage) await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
    else await send(sock, from, msg, '❌ Cannot open this type of view once media.');
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function dlvo(ctx) { return vv2(ctx); }

// ─── BLOCK/UNBLOCK ALL ───────────────────────────────────────────────────────
async function unblockall(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  await send(sock, from, msg, '🔓 Unblocking all contacts...');
  try {
    const blocklist = await sock.fetchBlocklist();
    if (!blocklist?.length) return send(sock, from, msg, '✅ No blocked contacts.');
    let unblocked = 0;
    for (const jid of blocklist) {
      try { await sock.updateBlockStatus(jid, 'unblock'); unblocked++; await new Promise(r => setTimeout(r, 500)); } catch {}
    }
    await send(sock, from, msg, `✅ Unblocked *${unblocked}* contacts!`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function listblocked(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  try {
    const blocklist = await sock.fetchBlocklist();
    if (!blocklist?.length) return send(sock, from, msg, '✅ No blocked contacts.');
    const lines = blocklist.map((j, i) => `${i + 1}. +${j.split('@')[0]}`).join('\n');
    await send(sock, from, msg, `🚫 *Blocked Contacts (${blocklist.length})*\n\n${lines}`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── GROUP ID ────────────────────────────────────────────────────────────────
async function groupid(ctx) {
  const { sock, from, msg, isGroup } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!isGroup) return send(sock, from, msg, '❌ Use this inside a group!');
  try {
    const metadata = await sock.groupMetadata(from);
    await send(sock, from, msg,
      `🆔 *Group ID*\n\n📌 *Name:* ${metadata.subject}\n🔑 *JID:* ${from}\n👥 *Members:* ${metadata.participants.length}`
    );
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── DELJUNK ─────────────────────────────────────────────────────────────────
async function deljunk(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const fs = require('fs');
  const path = require('path');
  const tmpDir = path.join(__dirname, '../../tmp');
  let deleted = 0, freed = 0;
  try {
    if (fs.existsSync(tmpDir)) {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        const fp = path.join(tmpDir, f);
        try { freed += fs.statSync(fp).size; fs.unlinkSync(fp); deleted++; } catch {}
      }
    }
    await send(sock, from, msg,
      `🗑️ *Junk Cleaned*\n\n` +
      `📁 Files deleted: *${deleted}*\n` +
      `💾 Space freed: *${(freed / 1024).toFixed(1)} KB*`
    );
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────
async function update(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  await send(sock, from, msg, '🔍 Checking for updates...');
  try {
    const { execSync } = require('child_process');
    const current = require('../../package.json').version || '2.0.0';
    await send(sock, from, msg,
      `📦 *Firebox Bot Update Check*\n\n` +
      `🏷️ *Current Version:* v${current}\n` +
      `✅ *Status:* Up to date\n\n` +
      `_To update manually: git pull && npm install_\n` +
      `_Then use .restart to apply changes._`
    );
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── SETPROFILEPIC ───────────────────────────────────────────────────────────
async function setprofilepic(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.imageMessage) return send(sock, from, msg, '🖼️ *Set Profile Photo*\n\nReply to an image with `.setprofilepic`');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant }, message: quoted };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    await sock.updateProfilePicture(sock.user.id, Buffer.concat(chunks));
    await send(sock, from, msg, '✅ *Profile photo updated!*');
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── AZA (AUTO AWAY) ─────────────────────────────────────────────────────────
async function aza(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const current = db.getBotSetting('azaEnabled');
  const msg2 = db.getBotSetting('azaMsg') || '🚀 Auto reply is active. The owner is away.';
  await send(sock, from, msg,
    `🤖 *AZA (Auto Away)*\n\n*Status:* ${current ? '✅ ON' : '❌ OFF'}\n*Message:* "${msg2}"\n\n` +
    `Commands:\n• .setaza <message> — set auto reply message\n• .aza on/off — toggle AZA\n• .resetaza — reset to default`
  );
}

async function setaza(ctx) {
  const { sock, from, msg, args, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const parts = text.split(' ');
  if (parts[0]?.toLowerCase() === 'on' || parts[0]?.toLowerCase() === 'off') {
    const val = parts[0].toLowerCase() === 'on';
    db.setBotSetting('azaEnabled', val);
    await send(sock, from, msg, val ? '✅ *AZA (Auto Away): ON*\nAuto replies will be sent when you\'re away.' : '🔴 *AZA: OFF*');
    return;
  }
  if (!text) return send(sock, from, msg, '❌ Usage: .setaza <auto reply message>');
  db.setBotSetting('azaMsg', text);
  db.setBotSetting('azaEnabled', true);
  await send(sock, from, msg, `✅ *AZA message set:*\n_"${text}"_\n\nAZA is now *ON*.`);
}

async function resetaza(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  db.setBotSetting('azaEnabled', false);
  db.setBotSetting('azaMsg', '');
  await send(sock, from, msg, '✅ *AZA reset to defaults.*');
}

// ─── AUTO SAVE STATUS ────────────────────────────────────────────────────────
async function autosavestatus(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = args[0]?.toLowerCase();
  if (!['on','off'].includes(val)) {
    const current = db.getBotSetting('autoSaveStatus');
    return send(sock, from, msg, `💾 *Auto Save Status*\n\nSaves all contacts' statuses automatically.\n\nCurrent: *${current ? 'ON ✅' : 'OFF ❌'}*\nUsage: .autosavestatus on/off`);
  }
  db.setBotSetting('autoSaveStatus', val === 'on');
  await send(sock, from, msg, val === 'on' ? '✅ *Auto Save Status: ON*\nAll statuses will be saved to your device.' : '🔴 *Auto Save Status: OFF*');
}

// ─── MODESTATUS ──────────────────────────────────────────────────────────────
async function modestatus(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mode = db.getBotSetting('botMode') || 'public';
  const avs = db.getBotSetting('autoViewStatus');
  const ars = db.getBotSetting('autoReactStatus');
  const asr = db.getBotSetting('autoStatusReply');
  const ads = db.getBotSetting('antiDeleteStatus');
  await send(sock, from, msg,
    `📊 *Mode & Status Overview*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `🤖 *Bot Mode:* ${mode === 'private' ? '🔒 PRIVATE' : '🌍 PUBLIC'}\n` +
    `👁️ *Auto View Status:* ${avs ? '✅' : '❌'}\n` +
    `💚 *Auto React Status:* ${ars ? '✅' : '❌'}\n` +
    `💬 *Auto Status Reply:* ${asr ? '✅' : '❌'}\n` +
    `🛡️ *Anti Delete Status:* ${ads ? '✅' : '❌'}\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`
  );
}

// ─── STICKER CMD ─────────────────────────────────────────────────────────────
async function setstickercmd(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .setstickercmd <command>\nExample: .setstickercmd s');
  db.setBotSetting('stickerCmd', text.trim().toLowerCase());
  await send(sock, from, msg, `✅ *Sticker command set to:* .${text.trim().toLowerCase()}`);
}

async function delstickercmd(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  db.setBotSetting('stickerCmd', '');
  await send(sock, from, msg, '✅ *Custom sticker command removed.* Using default: .sticker');
}

// ─── SUDO USERS ──────────────────────────────────────────────────────────────
async function addsudo(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Usage: .addsudo @user or .addsudo <number>');
  const list = db.getBotSetting('sudoUsers') || [];
  if (!list.includes(target)) list.push(target);
  db.setBotSetting('sudoUsers', list);
  await send(sock, from, msg, `✅ *@${target.split('@')[0]}* added to sudo users!\n\nSudo users have owner-level access to bot commands.`);
}

async function delsudo(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Usage: .delsudo @user or .delsudo <number>');
  const list = (db.getBotSetting('sudoUsers') || []).filter(u => u !== target);
  db.setBotSetting('sudoUsers', list);
  await send(sock, from, msg, `✅ *@${target.split('@')[0]}* removed from sudo users.`);
}

async function listsudo(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const list = db.getBotSetting('sudoUsers') || [];
  if (!list.length) return send(sock, from, msg, '📋 No sudo users configured. Use .addsudo to add one.');
  const lines = list.map((u, i) => `${i + 1}. @${u.split('@')[0]}`).join('\n');
  await send(sock, from, msg, `👑 *Sudo Users (${list.length})*\n\n${lines}`, { mentions: list });
}

// ─── IGNORE LIST ─────────────────────────────────────────────────────────────
async function addignorelist(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Usage: .addignorelist @user or .addignorelist <number>');
  const list = db.getBotSetting('ignoreList') || [];
  if (!list.includes(target)) list.push(target);
  db.setBotSetting('ignoreList', list);
  await send(sock, from, msg, `✅ *@${target.split('@')[0]}* added to ignore list.\n\nBot will ignore all their messages/commands.`);
}

async function delignorelist(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.participant;
  const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Usage: .delignorelist @user');
  const list = (db.getBotSetting('ignoreList') || []).filter(u => u !== target);
  db.setBotSetting('ignoreList', list);
  await send(sock, from, msg, `✅ *@${target.split('@')[0]}* removed from ignore list.`);
}

async function listignorelist(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const list = db.getBotSetting('ignoreList') || [];
  if (!list.length) return send(sock, from, msg, '📋 Ignore list is empty.');
  const lines = list.map((u, i) => `${i + 1}. @${u.split('@')[0]}`).join('\n');
  await send(sock, from, msg, `🚫 *Ignore List (${list.length})*\n\n${lines}`, { mentions: list });
}

// ─── COUNTRY CODES ───────────────────────────────────────────────────────────
async function addcountrycode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .addcountrycode <code>\nExample: .addcountrycode 254 (Kenya)\n\nOnly numbers starting with allowed codes can join groups when antiforeign is ON.');
  const code = text.replace(/[^0-9]/g, '');
  const list = db.getBotSetting('allowedCountryCodes') || [];
  if (!list.includes(code)) list.push(code);
  db.setBotSetting('allowedCountryCodes', list);
  await send(sock, from, msg, `✅ *Country code +${code}* added to whitelist.`);
}

async function delcountrycode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .delcountrycode <code>');
  const code = text.replace(/[^0-9]/g, '');
  const list = (db.getBotSetting('allowedCountryCodes') || []).filter(c => c !== code);
  db.setBotSetting('allowedCountryCodes', list);
  await send(sock, from, msg, `✅ Country code *+${code}* removed.`);
}

async function listcountrycode(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const list = db.getBotSetting('allowedCountryCodes') || [];
  if (!list.length) return send(sock, from, msg, '📋 No country codes whitelisted. All countries allowed.\n\nUse .addcountrycode <code> to restrict.');
  await send(sock, from, msg, `📋 *Allowed Country Codes (${list.length})*\n\n${list.map((c, i) => `${i + 1}. +${c}`).join('\n')}`);
}

// ─── GLOBAL BAD WORDS ────────────────────────────────────────────────────────
async function addbadword(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .addbadword <word>\n\n_Adds a global bad word that triggers action in ALL groups._');
  const list = db.getBotSetting('globalBadWords') || [];
  const word = text.toLowerCase().trim();
  if (!list.includes(word)) list.push(word);
  db.setBotSetting('globalBadWords', list);
  await send(sock, from, msg, `✅ *"${word}"* added to global bad words list.`);
}

async function deletebadword(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .deletebadword <word>');
  const list = (db.getBotSetting('globalBadWords') || []).filter(w => w !== text.toLowerCase().trim());
  db.setBotSetting('globalBadWords', list);
  await send(sock, from, msg, `✅ *"${text.toLowerCase()}"* removed from global bad words.`);
}

async function listbadword(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const list = db.getBotSetting('globalBadWords') || [];
  if (!list.length) return send(sock, from, msg, '📋 No global bad words configured.');
  await send(sock, from, msg, `🚫 *Global Bad Words (${list.length})*\n\n${list.map((w, i) => `${i + 1}. ${w}`).join('\n')}`);
}

// ─── SETTINGS COMMANDS ───────────────────────────────────────────────────────
function mkToggle(key, label) {
  return async function(ctx) {
    const { sock, from, msg, args } = ctx;
    if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
    const val = args[0]?.toLowerCase();
    if (!['on','off'].includes(val)) {
      const current = db.getBotSetting(key);
      return send(sock, from, msg, `⚙️ *${label}*\n\nCurrent: *${current ? 'ON ✅' : 'OFF ❌'}*\nUsage: .${ctx.command} on/off`);
    }
    db.setBotSetting(key, val === 'on');
    await send(sock, from, msg, val === 'on' ? `✅ *${label}: ON*` : `🔴 *${label}: OFF*`);
  };
}

const alwaysonline     = mkToggle('alwaysOnline',        'Always Online');
const antibug          = mkToggle('antiBug',             'Anti-Bug');
const antiviewonce     = mkToggle('antiViewOnce',        'Anti-View Once (auto-open)');
const autobio          = mkToggle('autoBio',             'Auto Bio (updates bio with uptime)');
const autoblock        = mkToggle('autoBlock',           'Auto Block (block unknown DMs)');
const autoreact        = mkToggle('autoReact',           'Auto React (react to all messages)');
const autoread         = mkToggle('autoRead',            'Auto Read (read all messages)');
const autorecord       = mkToggle('autoRecord',          'Auto Record (show recording status)');
const autorecordtyping = mkToggle('autoRecordTyping',    'Auto Record/Typing (combined)');
const autotype         = mkToggle('autoType',            'Auto Typing (show typing status)');
const chatbot          = mkToggle('aiChatbot',           'AI Chatbot');
const statusdelay      = async function(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const delay = parseInt(args[0]);
  if (isNaN(delay) || delay < 0) return send(sock, from, msg, `⏱️ *Status Delay*\n\nCurrent: *${db.getBotSetting('statusDelay') || 1000}ms*\nUsage: .statusdelay <ms>\nExample: .statusdelay 2000`);
  db.setBotSetting('statusDelay', delay);
  await send(sock, from, msg, `✅ *Status delay set to ${delay}ms*`);
};

// ─── SETTERS ─────────────────────────────────────────────────────────────────
async function setbotname(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .setbotname <name>');
  db.setBotSetting('botName', text);
  await send(sock, from, msg, `✅ *Bot name set to:* ${text}`);
}

async function setownername(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .setownername <name>');
  db.setBotSetting('ownerName', text);
  process.env.OWNER_NAME = text;
  await send(sock, from, msg, `✅ *Owner name set to:* ${text}`);
}

async function setownernumber(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .setownernumber <number>');
  const num = text.replace(/[^0-9]/g, '');
  db.setBotSetting('ownerNumber', num);
  process.env.OWNER_NUMBER = num;
  await send(sock, from, msg, `✅ *Owner number set to:* +${num}`);
}

async function settimezone(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, `⏰ *Timezone*\n\nCurrent: *${db.getBotSetting('timezone') || 'UTC'}*\nUsage: .settimezone <timezone>\nExample: .settimezone Africa/Nairobi`);
  db.setBotSetting('timezone', text.trim());
  process.env.TZ = text.trim();
  await send(sock, from, msg, `✅ *Timezone set to:* ${text.trim()}`);
}

async function setstickerauthor(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, `❌ Usage: .setstickerauthor <name>\nCurrent: ${db.getBotSetting('stickerAuthor') || 'Firebox'}`);
  db.setBotSetting('stickerAuthor', text);
  await send(sock, from, msg, `✅ *Sticker author set to:* ${text}`);
}

async function setstickerpackname(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, `❌ Usage: .setstickerpackname <name>\nCurrent: ${db.getBotSetting('stickerPackName') || 'Firebox'}`);
  db.setBotSetting('stickerPackName', text);
  await send(sock, from, msg, `✅ *Sticker pack name set to:* ${text}`);
}

async function setwatermark(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, `❌ Usage: .setwatermark <text>\nCurrent: ${db.getBotSetting('watermark') || 'None'}`);
  db.setBotSetting('watermark', text);
  await send(sock, from, msg, `✅ *Watermark set to:* "${text}"`);
}

async function setstatusemoji(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, `❌ Usage: .setstatusemoji <emoji>\nCurrent: ${db.getBotSetting('statusEmoji') || '🔥'}`);
  db.setBotSetting('statusEmoji', text.trim());
  await send(sock, from, msg, `✅ *Status emoji set to:* ${text.trim()}`);
}

async function setcontextlink(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, `❌ Usage: .setcontextlink <url>\nSets the link shown on forwarded messages.`);
  db.setBotSetting('contextLink', text.trim());
  await send(sock, from, msg, `✅ *Context link set to:* ${text.trim()}`);
}

async function setfont(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const fonts = ['bold', 'italic', 'bolditalic', 'mono', 'normal', 'smallcaps'];
  if (!text || !fonts.includes(text.toLowerCase()))
    return send(sock, from, msg, `🔤 *Set Font*\n\nUsage: .setfont <style>\nOptions: ${fonts.join(', ')}\n\nCurrent: ${db.getBotSetting('defaultFont') || 'normal'}`);
  db.setBotSetting('defaultFont', text.toLowerCase());
  await send(sock, from, msg, `✅ *Default font set to:* ${text.toLowerCase()}`);
}

async function setmenu(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) {
    db.setBotSetting('customMenu', '');
    return send(sock, from, msg, '✅ *Custom menu cleared.* Using default menu.');
  }
  db.setBotSetting('customMenu', text);
  await send(sock, from, msg, `✅ *Custom menu set!*\n\nPreview when using .menu:\n${text.slice(0, 200)}`);
}

async function setmenuimage(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.imageMessage) return send(sock, from, msg, '🖼️ *Set Menu Image*\n\nReply to an image with `.setmenuimage`\nThis image will be shown with the .menu command.');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant }, message: quoted };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const b64 = Buffer.concat(chunks).toString('base64');
    db.setBotSetting('menuImage', b64);
    await send(sock, from, msg, '✅ *Menu image set!*\nThis image will appear when users type .menu.');
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function setwarn(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const n = parseInt(args[0]);
  if (isNaN(n) || n < 1) return send(sock, from, msg, `⚠️ *Set Warn Limit*\n\nCurrent: *${db.getBotSetting('warnLimit') || 3}* strikes\nUsage: .setwarn <number>\nExample: .setwarn 5`);
  db.setBotSetting('warnLimit', n);
  await send(sock, from, msg, `✅ *Warn limit set to ${n} strikes.*\nMembers will be kicked after ${n} warnings.`);
}

// ─── ANTI-CALL MESSAGE ───────────────────────────────────────────────────────
async function anticalldm(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const val = (args[0] || '').toLowerCase();
  if (val !== 'on' && val !== 'off') {
    const current = db.getBotSetting('anticallDm') ? 'ON ✅' : 'OFF ❌';
    return send(sock, from, msg,
      `📵 *Anti-Call DM*\n\nCurrent status: *${current}*\n\n` +
      `Usage: *.anticalldm on* or *.anticalldm off*\n\n` +
      `When ON, any DM voice/video call to this bot is instantly rejected and the caller gets a warning message.\n\n` +
      `Customize the message with *.setanticallmsg <text>*`
    );
  }
  db.setBotSetting('anticallDm', val === 'on' ? 1 : 0);
  await send(sock, from, msg,
    val === 'on'
      ? `✅ *Anti-Call DM enabled!*\n\nAll incoming DM calls will now be rejected automatically.`
      : `❌ *Anti-Call DM disabled.*\n\nDM calls will no longer be auto-rejected.`
  );
}

async function setanticallmsg(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '❌ Usage: .setanticallmsg <message>');
  db.setBotSetting('antiCallMsg', text);
  await send(sock, from, msg, `✅ *Anti-call message set:*\n_"${text}"_`);
}
async function delanticallmsg(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  db.setBotSetting('antiCallMsg', '');
  await send(sock, from, msg, '✅ *Anti-call message cleared.*');
}
async function showanticallmsg(ctx) {
  const { sock, from, msg } = ctx;
  const m = db.getBotSetting('antiCallMsg') || '❌ Calls are not allowed!';
  await send(sock, from, msg, `📞 *Anti-Call Message:*\n\n_"${m}"_`);
}
async function testanticallmsg(ctx) {
  const { sock, from, msg } = ctx;
  const m = db.getBotSetting('antiCallMsg') || '❌ Calls are not allowed!';
  await send(sock, from, msg, `📞 *[TEST] Anti-Call Message:*\n\n${m}`);
}

// ─── WELCOME / GOODBYE MANAGEMENT ────────────────────────────────────────────
async function delwelcome(ctx) {
  const { sock, from, msg } = ctx;
  if (!await (async () => { if (!ctx.isGroup) { await send(sock, from, msg, '❌ Groups only!'); return false; } return true; })()) return;
  const admins = await (async () => {
    const a = await (async () => { try { const m = await sock.groupMetadata(from); return m.participants.filter(p => p.admin).map(p => p.id); } catch { return []; } })();
    if (!a.includes(ctx.sender) && !ctx.isOwner) { await send(sock, from, msg, '❌ Admins only!'); return null; }
    return a;
  })();
  if (!admins) return;
  db.setGroup(from, { welcomeMsg: '', welcome: 0 });
  await send(sock, from, msg, '✅ *Welcome message cleared.*');
}
async function showwelcome(ctx) {
  const { sock, from, msg } = ctx;
  const grp = db.getGroup(from);
  const wm = grp.welcomeMsg || '👋 Welcome {name} to *{group}*!';
  await send(sock, from, msg, `👋 *Welcome Message:*\n\n${wm}\n\n_Status: ${grp.welcome ? '✅ ON' : '❌ OFF'}_`);
}
async function testwelcome(ctx) {
  const { sock, from, msg, sender } = ctx;
  const grp = db.getGroup(from);
  const meta = await sock.groupMetadata(from).catch(() => ({ subject: 'Test Group' }));
  const wm = (grp.welcomeMsg || '👋 Welcome {name} to *{group}*!')
    .replace('{name}', `@${sender.split('@')[0]}`).replace('{group}', meta.subject);
  await sock.sendMessage(from, { text: `👋 *[TEST] Welcome Message:*\n\n${wm}`, mentions: [sender] }, { quoted: msg });
}
async function delgoodbye(ctx) {
  const { sock, from, msg } = ctx;
  db.setGroup(from, { goodbyeMsg: '' });
  await send(sock, from, msg, '✅ *Goodbye message cleared.*');
}
async function showgoodbye(ctx) {
  const { sock, from, msg } = ctx;
  const grp = db.getGroup(from);
  const gm = grp.goodbyeMsg || '👋 Goodbye {name}! We\'ll miss you.';
  await send(sock, from, msg, `👋 *Goodbye Message:*\n\n${gm}`);
}
async function testgoodbye(ctx) {
  const { sock, from, msg, sender } = ctx;
  const grp = db.getGroup(from);
  const gm = (grp.goodbyeMsg || '👋 Goodbye {name}! We\'ll miss you.').replace('{name}', `@${sender.split('@')[0]}`);
  await sock.sendMessage(from, { text: `👋 *[TEST] Goodbye Message:*\n\n${gm}`, mentions: [sender] }, { quoted: msg });
}

// ─── GET SETTINGS / RESET ────────────────────────────────────────────────────
async function getsettings(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  const s = (key, label, type = 'bool') => {
    const val = db.getBotSetting(key);
    if (type === 'bool') return `${val ? '✅' : '❌'} ${label}`;
    return `📌 ${label}: ${val || 'not set'}`;
  };
  await send(sock, from, msg,
    `⚙️ *Bot Settings*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
    `*Mode:* ${db.getBotSetting('botMode') || 'public'}\n` +
    `*Prefix:* ${process.env.PREFIX || '.'}\n\n` +
    `*Automation:*\n` +
    `${s('aiChatbot','AI Chatbot')}\n${s('autoViewStatus','Auto View Status')}\n` +
    `${s('autoReactStatus','Auto React Status')}\n${s('autoRead','Auto Read')}\n` +
    `${s('autoType','Auto Typing')}\n${s('autoRecord','Auto Record')}\n` +
    `${s('alwaysOnline','Always Online')}\n${s('autoBio','Auto Bio')}\n\n` +
    `*Protection:*\n` +
    `${s('antiDelete','Anti Delete')}\n${s('antiEdit','Anti Edit')}\n` +
    `${s('antiCall','Anti Call')}\n${s('antiViewOnce','Anti View Once')}\n` +
    `${s('antiBug','Anti Bug')}\n\n` +
    `*Info:*\n` +
    `${s('botName','Bot Name','str')}\n${s('ownerName','Owner Name','str')}\n` +
    `${s('stickerAuthor','Sticker Author','str')}\n${s('watermark','Watermark','str')}\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`
  );
}

async function resetsetting(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  if (args[0]?.toLowerCase() !== 'confirm') {
    return send(sock, from, msg, '⚠️ *Reset ALL Settings*\n\nThis will reset ALL bot settings to defaults!\n\nAre you sure? Type:\n`.resetsetting confirm`');
  }
  const keysToReset = ['aiChatbot','autoViewStatus','autoReactStatus','autoRead','autoType','autoRecord','alwaysOnline','autoBio','antiDelete','antiEdit','antiCall','antiViewOnce','antiBug','autoBlock','botMode','statusDelay'];
  for (const key of keysToReset) db.setBotSetting(key, false);
  db.setBotSetting('botMode', 'public');
  await send(sock, from, msg, '✅ *All settings reset to defaults!*');
}

async function statussettings(ctx) {
  const { sock, from, msg } = ctx;
  if (!isOwnerCheck(ctx)) return send(sock, from, msg, '❌ Owner only!');
  await send(sock, from, msg,
    `📊 *Status Settings*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `👁️ Auto View: ${db.getBotSetting('autoViewStatus') ? '✅' : '❌'}\n` +
    `💚 Auto React: ${db.getBotSetting('autoReactStatus') ? '✅' : '❌'}\n` +
    `💬 Auto Reply: ${db.getBotSetting('autoStatusReply') ? '✅' : '❌'}\n` +
    `🛡️ Anti Delete: ${db.getBotSetting('antiDeleteStatus') ? '✅' : '❌'}\n` +
    `💾 Auto Save: ${db.getBotSetting('autoSaveStatus') ? '✅' : '❌'}\n` +
    `⏱️ Delay: ${db.getBotSetting('statusDelay') || 1000}ms\n` +
    `😀 Emoji: ${db.getBotSetting('statusEmoji') || '🔥'}\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `_Use .autoviewstatus, .autoreactstatus etc. to toggle_`
  );
}

module.exports = {
  inbox, sharecf, clearcf, deleteMsg, block, unblock, restart, react, setprefix, forward, join, leave, setbio,
  autoviewstatus, autoreactstatus, autoreply, autostatusreply, antideletestatus, antidelete, antiedit,
  aichat, broadcaststatus, tostatus, schedule, schedulelist, cancelschedule,
  broadcast, addbc, removebc, listbc, clearbc, away, statusstats, clearstatusstats, mode, dmgroup,
  disk, hostip, online, lastseen, ppprivacy, readreceipts, gcaddprivacy,
  toviewonce, vv2, dlvo, unblockall, listblocked, groupid, deljunk, update, setprofilepic,
  aza, setaza, resetaza, autosavestatus, modestatus, setstickercmd, delstickercmd,
  addsudo, delsudo, listsudo, addignorelist, delignorelist, listignorelist,
  addcountrycode, delcountrycode, listcountrycode, addbadword, deletebadword, listbadword,
  alwaysonline, antibug, antiviewonce, autobio, autoblock, autoreact, autoread, autorecord, autorecordtyping, autotype, chatbot,
  statusdelay, setbotname, setownername, setownernumber, settimezone,
  setstickerauthor, setstickerpackname, setwatermark, setstatusemoji, setcontextlink, setfont,
  setmenu, setmenuimage, setwarn,
  dead,
  anticalldm,
  setanticallmsg, delanticallmsg, showanticallmsg, testanticallmsg,
  delwelcome, showwelcome, testwelcome, delgoodbye, showgoodbye, testgoodbye,
  getsettings, resetsetting, statussettings
};
