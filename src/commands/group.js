const db = require('../database');
const { sendFireboxCard } = require('../card');

async function getAdmins(sock, jid) {
  const metadata = await sock.groupMetadata(jid);
  return metadata.participants.filter(p => p.admin).map(p => p.id);
}

function getMentioned(msg) {
  return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

async function send(sock, from, msg, text, extra = {}) {
  // If the response needs mentions (e.g. kick/add confirmations), pass them through
  return sendFireboxCard(sock, from, msg, {
    title: '👥 Firebox Group',
    content: text,
    mentions: extra.mentions,
  });
}

async function requireGroup(ctx) {
  if (!ctx.isGroup) { await send(ctx.sock, ctx.from, ctx.msg, '❌ Groups only!'); return false; }
  return true;
}

async function requireAdmin(ctx) {
  const { sock, from, msg, sender, isOwner } = ctx;
  const admins = await getAdmins(sock, from);
  if (!admins.includes(sender) && !isOwner) {
    await send(sock, from, msg, '❌ Admins only!');
    return null;
  }
  return admins;
}

async function requireBotAdmin(ctx, admins) {
  if (!admins.includes(ctx.botNumber)) {
    await send(ctx.sock, ctx.from, ctx.msg, '❌ I need to be an admin first!');
    return false;
  }
  return true;
}

// ─── MEMBER MANAGEMENT ───────────────────────────────────────────────────────

async function kick(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;

  const target = getMentioned(msg) || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
  if (!target) return send(sock, from, msg, '❌ Reply to or mention the user to kick!');

  try {
    await sock.groupParticipantsUpdate(from, [target], 'remove');
    await send(sock, from, msg, `✅ @${target.split('@')[0]} has been kicked!`, { mentions: [target] });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to kick: ${err.message}`);
  }
}

async function add(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  if (!args[0]) return send(sock, from, msg, '❌ Usage: .add <number>');

  const number = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  try {
    await sock.groupParticipantsUpdate(from, [number], 'add');
    await send(sock, from, msg, `✅ @${number.split('@')[0]} has been added!`, { mentions: [number] });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to add: ${err.message}`);
  }
}

async function promote(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;

  const target = getMentioned(msg);
  if (!target) return send(sock, from, msg, '❌ Reply to the user you want to promote!');
  await sock.groupParticipantsUpdate(from, [target], 'promote');
  await send(sock, from, msg, `⭐ @${target.split('@')[0]} is now an admin!`, { mentions: [target] });
}

async function demote(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;

  const target = getMentioned(msg);
  if (!target) return send(sock, from, msg, '❌ Reply to the admin you want to demote!');
  await sock.groupParticipantsUpdate(from, [target], 'demote');
  await send(sock, from, msg, `🔽 @${target.split('@')[0]} has been demoted!`, { mentions: [target] });
}

async function kickall(ctx) {
  const { sock, from, msg, botNumber } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;

  const metadata = await sock.groupMetadata(from);
  const nonAdmins = metadata.participants
    .filter(p => !p.admin && p.id !== botNumber)
    .map(p => p.id);

  if (!nonAdmins.length) return send(sock, from, msg, '❌ No non-admin members to kick!');

  await send(sock, from, msg, `⚠️ Kicking ${nonAdmins.length} members...`);
  for (const jid of nonAdmins) {
    try { await sock.groupParticipantsUpdate(from, [jid], 'remove'); } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  await send(sock, from, msg, `✅ Kicked ${nonAdmins.length} members!`);
}

// ─── GROUP SETTINGS ───────────────────────────────────────────────────────────

async function mute(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  await sock.groupSettingUpdate(from, 'announcement');
  db.setGroup(from, { muted: 1 });
  await send(sock, from, msg, '🔇 Group closed! Only admins can send messages.');
}

async function unmute(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  await sock.groupSettingUpdate(from, 'not_announcement');
  db.setGroup(from, { muted: 0 });
  await send(sock, from, msg, '🔊 Group opened! Everyone can send messages.');
}

async function setgroupname(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .setgroupname <new name>');
  try {
    await sock.groupUpdateSubject(from, text);
    await send(sock, from, msg, `✅ Group name changed to *${text}*`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed: ${err.message}`);
  }
}

async function setdesc(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .setdesc <new description>');
  try {
    await sock.groupUpdateDescription(from, text);
    await send(sock, from, msg, `✅ Group description updated!`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed: ${err.message}`);
  }
}

// ─── INVITE LINK ─────────────────────────────────────────────────────────────

async function link(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    const code = await sock.groupInviteCode(from);
    await send(sock, from, msg, `🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to get link: ${err.message}`);
  }
}

async function resetlink(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  try {
    await sock.groupRevokeInvite(from);
    const code = await sock.groupInviteCode(from);
    await send(sock, from, msg, `✅ *Invite link reset!*\n\nNew link: https://chat.whatsapp.com/${code}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed: ${err.message}`);
  }
}

// ─── TAGGING ─────────────────────────────────────────────────────────────────

async function tagall(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;

  const metadata = await sock.groupMetadata(from);
  const members = metadata.participants.map(p => p.id);
  const mentions = members.map(m => `@${m.split('@')[0]}`).join(' ');
  await sock.sendMessage(from, {
    text: `📢 *${text || 'Attention everyone!'}*\n\n${mentions}`,
    mentions: members
  }, { quoted: msg });
}

async function hidetag(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;

  const metadata = await sock.groupMetadata(from);
  const members = metadata.participants.map(p => p.id);
  await sock.sendMessage(from, {
    text: text || '📢',
    mentions: members
  }, { quoted: msg });
}

async function tagadmin(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;

  const metadata = await sock.groupMetadata(from);
  const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
  if (!admins.length) return send(sock, from, msg, '❌ No admins found!');
  const mentions = admins.map(a => `@${a.split('@')[0]}`).join(' ');
  await sock.sendMessage(from, {
    text: `👮 *Admins*\n\n${mentions}${text ? '\n\n' + text : ''}`,
    mentions: admins
  }, { quoted: msg });
}

async function totalmembers(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const metadata = await sock.groupMetadata(from);
  const total = metadata.participants.length;
  const admins = metadata.participants.filter(p => p.admin).length;
  const regular = total - admins;
  await send(sock, from, msg,
    `👥 *Group Members*\n\n` +
    `📊 Total: *${total}*\n` +
    `👮 Admins: *${admins}*\n` +
    `👤 Members: *${regular}*`
  );
}

// ─── POLL ────────────────────────────────────────────────────────────────────

async function poll(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  if (!text) return send(sock, from, msg, '📊 Usage: .poll Question | Option1 | Option2 | Option3\nExample: .poll Best fruit? | Apple | Banana | Mango');

  const parts = text.split('|').map(s => s.trim());
  if (parts.length < 3) return send(sock, from, msg, '❌ Need at least a question and 2 options!\nFormat: .poll Question | Option1 | Option2');

  const [question, ...options] = parts;
  try {
    await sock.sendMessage(from, {
      poll: { name: question, values: options.slice(0, 12), selectableCount: 1 }
    }, { quoted: msg });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to create poll: ${err.message}`);
  }
}

// ─── WARN SYSTEM ─────────────────────────────────────────────────────────────

async function warn(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;

  const target = getMentioned(msg);
  if (!target) return send(sock, from, msg, '❌ Reply to or mention the user to warn!');

  const MAX_WARNS = 3;
  const count = db.addWarn(from, target);
  const reason = text || 'No reason given';

  if (count >= MAX_WARNS) {
    db.resetWarn(from, target);
    try {
      await sock.groupParticipantsUpdate(from, [target], 'remove');
      await send(sock, from, msg,
        `⚠️ @${target.split('@')[0]} has been kicked after *${MAX_WARNS} warnings*!\n📝 Last reason: ${reason}`,
        { mentions: [target] }
      );
    } catch {
      await send(sock, from, msg, `⚠️ @${target.split('@')[0]} reached max warnings but could not be kicked!`, { mentions: [target] });
    }
  } else {
    await send(sock, from, msg,
      `⚠️ *Warning ${count}/${MAX_WARNS}*\n\n👤 User: @${target.split('@')[0]}\n📝 Reason: ${reason}\n\n_${MAX_WARNS - count} warning(s) left before kick_`,
      { mentions: [target] }
    );
  }
}

async function listwarn(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const warns = db.listWarns(from);
  const entries = Object.entries(warns);
  if (!entries.length) return send(sock, from, msg, '✅ No warnings in this group!');
  const list = entries.map(([jid, count]) => `• @${jid.split('@')[0]} — ${count} warn(s)`).join('\n');
  const mentions = entries.map(([jid]) => jid);
  await sendFireboxCard(sock, from, msg, { title: '⚠️ Warn List', content: list, mentions });
}

async function resetwarn(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const target = getMentioned(msg);
  if (!target) return send(sock, from, msg, '❌ Reply to or mention the user!');
  db.resetWarn(from, target);
  await send(sock, from, msg, `✅ Warnings reset for @${target.split('@')[0]}`, { mentions: [target] });
}

// ─── AUTO FEATURES ────────────────────────────────────────────────────────────

async function antiban(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const val = text?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '❌ Usage: .antiban on/off');
  db.setGroup(from, { antiban: val === 'on' ? 1 : 0 });
  await send(sock, from, msg, val === 'on'
    ? '🛡️ *Anti-Ban: ON ✅*\n\n_Bot will now simulate human typing with random delays before responding in this group to reduce ban risk._'
    : '🔴 *Anti-Ban: OFF ❌*\n\n_Bot will respond instantly in this group._');
}

async function antilink(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const val = text?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '❌ Usage: .antilink on/off');
  db.setGroup(from, { antilink: val === 'on' ? 1 : 0 });
  await send(sock, from, msg, `🔗 Anti-link is now *${val === 'on' ? 'ON ✅' : 'OFF ❌'}*`);
}

async function anticall(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const val = text?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '❌ Usage: .anticall on/off');
  db.setGroup(from, { anticall: val === 'on' ? 1 : 0 });
  await send(sock, from, msg, `📵 Anti-call is now *${val === 'on' ? 'ON ✅' : 'OFF ❌'}*`);
}


async function welcome(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const val = text?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '❌ Usage: .welcome on/off');
  db.setGroup(from, { welcome: val === 'on' ? 1 : 0 });
  await send(sock, from, msg, `👋 Welcome messages are now *${val === 'on' ? 'ON ✅' : 'OFF ❌'}*`);
}

async function setwelcome(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .setwelcome <message>\nUse {name} for member name, {group} for group name');
  db.setGroup(from, { welcomeMsg: text, welcome: 1 });
  await send(sock, from, msg, `✅ Welcome message set!\n\nPreview:\n${text.replace('{name}', 'NewMember').replace('{group}', 'This Group')}`);
}

async function setgoodbye(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .setgoodbye <message>\nUse {name} for member name');
  db.setGroup(from, { goodbyeMsg: text });
  await send(sock, from, msg, `✅ Goodbye message set!`);
}

// ─── INFO ────────────────────────────────────────────────────────────────────

async function groupinfo(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const metadata = await sock.groupMetadata(from);
  const admins = metadata.participants.filter(p => p.admin).length;
  const total = metadata.participants.length;
  const created = new Date(metadata.creation * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const grp = db.getGroup(from);

  const text = `
👥 *GROUP INFORMATION*
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
📌 *Name:* ${metadata.subject}
📝 *Desc:* ${metadata.desc || 'None'}
👤 *Members:* ${total}
👮 *Admins:* ${admins}
📅 *Created:* ${created}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
🔗 *Anti-link:* ${grp.antilink ? 'ON ✅' : 'OFF ❌'}
👋 *Welcome:* ${grp.welcome ? 'ON ✅' : 'OFF ❌'}
📵 *Anti-call:* ${grp.anticall ? 'ON ✅' : 'OFF ❌'}
🗑️ *Anti-delete:* ${grp.antidelete ? 'ON ✅' : 'OFF ❌'}
🛡️ *Anti-ban:* ${grp.antiban ? 'ON ✅' : 'OFF ❌'}
🔇 *Muted:* ${grp.muted ? 'YES' : 'NO'}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`.trim();

  await send(sock, from, msg, text);
}

// ─── EVENT HANDLERS ──────────────────────────────────────────────────────────

async function antibadword(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const val = args[0]?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '❌ Usage: .antibadword on/off');
  db.setGroup(from, { antibadword: val === 'on' ? 1 : 0 });
  await send(sock, from, msg, val === 'on'
    ? '✅ *Anti-Bad Word: ON*\n\n🚫 Members who send banned words will be warned and kicked after 3 strikes.'
    : '🔴 *Anti-Bad Word: OFF*');
}

async function addword(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .addword <word>');
  const list = db.addBadWord(from, text);
  await send(sock, from, msg, `✅ *"${text.toLowerCase()}"* added to banned words.\n📋 Total banned: ${list.length}`);
}

async function removeword(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .removeword <word>');
  const list = db.removeBadWord(from, text);
  await send(sock, from, msg, `✅ *"${text.toLowerCase()}"* removed from banned words.\n📋 Total banned: ${list.length}`);
}

async function listwords(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const list = db.getBadWords(from);
  if (!list.length) return send(sock, from, msg, '📋 No banned words set for this group.');
  await send(sock, from, msg, `🚫 *Banned Words (${list.length})*\n\n${list.map((w, i) => `${i + 1}. ${w}`).join('\n')}`);
}

async function checkBadWord(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antibadword) return;

  const badwords = grp.badwords || [];
  if (!badwords.length) return;

  const body = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || ''
  ).toLowerCase();

  if (!body) return;

  const found = badwords.find(w => body.includes(w));
  if (!found) return;

  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;

    // Delete the offending message
    await sock.sendMessage(from, { delete: msg.key });

    // Warn the user (reuse warn system)
    const warnCount = db.addWarn(from, sender);
    const MAX_WARNS = 3;

    if (warnCount >= MAX_WARNS) {
      db.resetWarn(from, sender);
      await sock.groupParticipantsUpdate(from, [sender], 'remove');
      await sock.sendMessage(from, {
        text: `🚫 @${sender.split('@')[0]} was *kicked* for using banned words (reached ${MAX_WARNS} strikes).`,
        mentions: [sender]
      });
    } else {
      await sock.sendMessage(from, {
        text: `⚠️ @${sender.split('@')[0]}, the word *"${found}"* is banned here!\n🔢 Strike *${warnCount}/${MAX_WARNS}* — you will be kicked at ${MAX_WARNS}.`,
        mentions: [sender]
      });
    }
  } catch (err) {
    console.error('[ANTIBADWORD]', err.message);
  }
}

async function checkAntiLink(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antilink) return;

  const body = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.message?.imageMessage?.caption
    || msg.message?.videoMessage?.caption
    || '';

  const linkRegex = /(?:https?:\/\/|www\.)[\w-]+(\.[\w-]+)+[^\s]*/gi;
  if (!linkRegex.test(body)) return;

  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;
    await sock.sendMessage(from, { delete: msg.key });
    await sock.sendMessage(from, {
      text: `⚠️ @${sender.split('@')[0]}, links are not allowed here!`,
      mentions: [sender]
    });
  } catch (err) {
    console.error('[ANTILINK]', err.message);
  }
}

async function handleGroupParticipantUpdate(sock, update) {
  const { id, participants, action } = update;
  const grp = db.getGroup(id);
  if (!grp.welcome) return;

  let metadata;
  try { metadata = await sock.groupMetadata(id); } catch { return; }

  for (const participant of participants) {
    const name = participant.split('@')[0];
    const groupName = metadata.subject;

    if (action === 'add') {
      const welcomeMsg = grp.welcomeMsg
        ? grp.welcomeMsg.replace('{name}', `@${name}`).replace('{group}', groupName)
        : `👋 Welcome @${name} to *${groupName}*! 🎉\nWe're happy to have you here!`;
      await sendFireboxCard(sock, id, null, {
        title: '👋 Welcome!',
        content: welcomeMsg,
        mentions: [participant],
        noQuote: true,
      });
    } else if (action === 'remove') {
      const goodbyeMsg = grp.goodbyeMsg
        ? grp.goodbyeMsg.replace('{name}', `@${name}`)
        : `👋 Goodbye @${name}! We'll miss you. 😢`;
      await sendFireboxCard(sock, id, null, {
        title: '👋 Goodbye',
        content: goodbyeMsg,
        mentions: [participant],
        noQuote: true,
      });
    }
  }
}

// ─── ANTI-* TOGGLES ──────────────────────────────────────────────────────────

function mkAntiToggle(key, label, desc) {
  return async function(ctx) {
    const { sock, from, msg, args } = ctx;
    if (!await requireGroup(ctx)) return;
    const admins = await requireAdmin(ctx);
    if (!admins) return;
    const val = args[0]?.toLowerCase();
    if (val !== 'on' && val !== 'off') return send(sock, from, msg, `❌ Usage: .${key} on/off`);
    db.setGroup(from, { [key]: val === 'on' ? 1 : 0 });
    await send(sock, from, msg, val === 'on' ? `✅ *${label}: ON* ✅\n\n${desc}` : `🔴 *${label}: OFF*`);
  };
}

const antibot         = mkAntiToggle('antibot',        'Anti-Bot',            '🤖 Bot accounts will be automatically removed from this group.');
const antidemote      = mkAntiToggle('antidemote',     'Anti-Demote',         '🛡️ Any admin who demotes another admin will be removed.');
const antiforeign     = mkAntiToggle('antiforeign',    'Anti-Foreign',        '🌍 Numbers from unauthorized country codes will be removed.');
const antiforward     = mkAntiToggle('antiforward',    'Anti-Forward',        '📤 Forwarded messages will be automatically deleted.');
const antigroupmention = mkAntiToggle('antigroupmention', 'Anti-Group Mention', '🔕 @everyone / group mention broadcasts will be deleted.');
const antilinkgc      = mkAntiToggle('antilinkgc',     'Anti-Link (Groups)',   '🔗 WhatsApp group invite links will be deleted from this group.');
const antimessage     = mkAntiToggle('antimessage',    'Anti-Message',        '🔇 Non-admin messages will be deleted. Only admins can speak.');
const antisticker     = mkAntiToggle('antisticker',    'Anti-Sticker',        '🚫 Stickers sent by non-admins will be automatically deleted.');
const antitag         = mkAntiToggle('antitag',        'Anti-Tag',            '🏷️ Tagging/mentioning members will not be allowed from non-admins.');
const antitagadmin    = mkAntiToggle('antitagadmin',   'Anti-Tag Admin',      '👮 Tagging admins will not be allowed from non-admin members.');

// ─── JOIN REQUEST MANAGEMENT ─────────────────────────────────────────────────

async function listrequests(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    const pending = await sock.groupRequestParticipantsList(from);
    if (!pending?.length) return send(sock, from, msg, '📋 No pending join requests.');
    const lines = pending.map((p, i) => `${i + 1}. +${p.jid?.split('@')[0]}`).join('\n');
    await send(sock, from, msg, `📋 *Pending Join Requests (${pending.length})*\n\n${lines}\n\n_Use .approve <number> or .approveall_`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function approve(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    const mentioned = getMentioned(msg);
    const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
    if (!target) {
      const pending = await sock.groupRequestParticipantsList(from);
      if (!pending?.length) return send(sock, from, msg, '📋 No pending join requests.');
      const first = pending[0].jid;
      await sock.groupRequestParticipantsUpdate(from, [first], 'approve');
      return send(sock, from, msg, `✅ Approved *+${first.split('@')[0]}*`);
    }
    await sock.groupRequestParticipantsUpdate(from, [target], 'approve');
    await send(sock, from, msg, `✅ Approved *+${target.split('@')[0]}*`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function approveall(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    const pending = await sock.groupRequestParticipantsList(from);
    if (!pending?.length) return send(sock, from, msg, '📋 No pending join requests.');
    const jids = pending.map(p => p.jid);
    await sock.groupRequestParticipantsUpdate(from, jids, 'approve');
    await send(sock, from, msg, `✅ Approved *${jids.length}* pending requests!`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function reject(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    const mentioned = getMentioned(msg);
    const target = mentioned || (args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null);
    if (!target) return send(sock, from, msg, '❌ Usage: .reject @user or .reject <number>');
    await sock.groupRequestParticipantsUpdate(from, [target], 'reject');
    await send(sock, from, msg, `❌ Rejected *+${target.split('@')[0]}*`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function disapproveall(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    const pending = await sock.groupRequestParticipantsList(from);
    if (!pending?.length) return send(sock, from, msg, '📋 No pending join requests.');
    const jids = pending.map(p => p.jid);
    await sock.groupRequestParticipantsUpdate(from, jids, 'reject');
    await send(sock, from, msg, `❌ Rejected *${jids.length}* pending requests.`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── JOIN CODES ──────────────────────────────────────────────────────────────

async function addcode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .addcode <label>\nThis saves the current group invite link with a label.\nExample: .addcode Main Group');
  try {
    const inviteCode = await sock.groupInviteCode(from);
    const grp = db.getGroup(from);
    const codes = grp.savedCodes || {};
    codes[text.trim()] = `https://chat.whatsapp.com/${inviteCode}`;
    db.setGroup(from, { savedCodes: codes });
    await send(sock, from, msg, `✅ *Code saved as "${text.trim()}"*\n🔗 https://chat.whatsapp.com/${inviteCode}`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function delcode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!text) return send(sock, from, msg, '❌ Usage: .delcode <label>');
  const grp = db.getGroup(from);
  const codes = grp.savedCodes || {};
  if (!codes[text.trim()]) return send(sock, from, msg, `❌ No saved code with label "${text.trim()}"`);
  delete codes[text.trim()];
  db.setGroup(from, { savedCodes: codes });
  await send(sock, from, msg, `✅ Code *"${text.trim()}"* deleted.`);
}

async function listcode(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const grp = db.getGroup(from);
  const codes = grp.savedCodes || {};
  const entries = Object.entries(codes);
  if (!entries.length) return send(sock, from, msg, '📋 No saved join codes for this group. Use .addcode <label> to save one.');
  const lines = entries.map(([label, url], i) => `*${i + 1}.* ${label}\n   🔗 ${url}`).join('\n\n');
  await send(sock, from, msg, `📋 *Saved Join Codes (${entries.length})*\n\n${lines}`);
}

// ─── WHITELIST ───────────────────────────────────────────────────────────────

async function allow(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const target = getMentioned(msg);
  if (!target) return send(sock, from, msg, '❌ Reply to or tag the user to allow.\nAllowed users bypass anti-link, anti-forward, etc.');
  const grp = db.getGroup(from);
  const list = grp.allowedUsers || [];
  if (!list.includes(target)) list.push(target);
  db.setGroup(from, { allowedUsers: list });
  await send(sock, from, msg, `✅ *@${target.split('@')[0]}* is now allowed — exempt from group restrictions.`, { mentions: [target] });
}

async function delallowed(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const target = getMentioned(msg);
  if (!target) return send(sock, from, msg, '❌ Reply to or tag the user to remove from allowed list.');
  const grp = db.getGroup(from);
  const list = (grp.allowedUsers || []).filter(u => u !== target);
  db.setGroup(from, { allowedUsers: list });
  await send(sock, from, msg, `✅ *@${target.split('@')[0]}* removed from allowed list.`, { mentions: [target] });
}

async function listallowed(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const grp = db.getGroup(from);
  const list = grp.allowedUsers || [];
  if (!list.length) return send(sock, from, msg, '📋 No users in the allowed list.');
  const lines = list.map((u, i) => `${i + 1}. @${u.split('@')[0]}`).join('\n');
  await send(sock, from, msg, `📋 *Allowed Users (${list.length})*\n\n${lines}`, { mentions: list });
}

// ─── GROUP PROFILE PHOTO ─────────────────────────────────────────────────────

async function getgrouppp(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  try {
    const ppUrl = await sock.profilePictureUrl(from, 'image');
    const axios = require('axios');
    const res = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 15000 });
    await sock.sendMessage(from, { image: Buffer.from(res.data), caption: '🖼️ *Group Profile Photo*', mimetype: 'image/jpeg' }, { quoted: msg });
  } catch { await send(ctx.sock, from, msg, '❌ No profile photo set for this group.'); }
}

async function setppgroup(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.imageMessage) return send(sock, from, msg, '🖼️ *Set Group Photo*\n\nReply to an image with `.setppgroup`');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = { key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant }, message: quoted };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    await sock.updateProfilePicture(from, Buffer.concat(chunks));
    await send(sock, from, msg, '✅ *Group profile photo updated!*');
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function delppgroup(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  try {
    await sock.removeProfilePicture(from);
    await send(sock, from, msg, '✅ *Group profile photo removed!*');
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── ACTIVE / INACTIVE MEMBERS ───────────────────────────────────────────────

async function listactive(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const grp = db.getGroup(from);
  const activeSenders = grp.activeSenders || {};
  const entries = Object.entries(activeSenders).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return send(sock, from, msg, '📊 No activity data yet. Members need to send messages first.\n\n_Data is tracked from the moment this command is used._');
  const metadata = await sock.groupMetadata(from);
  const memberJids = new Set(metadata.participants.map(p => p.id));
  const active = entries.filter(([jid]) => memberJids.has(jid)).slice(0, 30);
  const lines = active.map(([jid, ts], i) => {
    const d = new Date(ts);
    const ago = Math.round((Date.now() - ts) / 60000);
    const timeStr = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`;
    return `${i + 1}. @${jid.split('@')[0]} — _${timeStr}_`;
  }).join('\n');
  await send(sock, from, msg, `📊 *Active Members (last seen)*\n\n${lines}`, { mentions: active.map(([j]) => j) });
}

async function listinactive(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const days = parseInt(args[0]) || 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const grp = db.getGroup(from);
  const activeSenders = grp.activeSenders || {};
  const metadata = await sock.groupMetadata(from);
  const admJids = new Set(metadata.participants.filter(p => p.admin).map(p => p.id));
  const inactive = metadata.participants.filter(p => {
    if (admJids.has(p.id)) return false;
    const lastSeen = activeSenders[p.id];
    return !lastSeen || lastSeen < cutoff;
  });
  if (!inactive.length) return send(sock, from, msg, `✅ No inactive members found (inactive > ${days} days).`);
  const lines = inactive.slice(0, 30).map((p, i) => {
    const lastSeen = activeSenders[p.id];
    const timeStr = lastSeen ? `last seen ${Math.round((Date.now() - lastSeen) / 86400000)}d ago` : 'never seen';
    return `${i + 1}. @${p.id.split('@')[0]} — _${timeStr}_`;
  }).join('\n');
  await send(sock, from, msg,
    `😴 *Inactive Members (>${days} days)*\n\n${lines}${inactive.length > 30 ? `\n\n_...and ${inactive.length - 30} more_` : ''}\n\n_Use .kickinactive ${days} to remove them_`,
    { mentions: inactive.slice(0, 30).map(p => p.id) }
  );
}

async function kickinactive(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  const days = parseInt(args[0]) || 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const grp = db.getGroup(from);
  const activeSenders = grp.activeSenders || {};
  const metadata = await sock.groupMetadata(from);
  const admJids = new Set(metadata.participants.filter(p => p.admin).map(p => p.id));
  const inactive = metadata.participants.filter(p => {
    if (admJids.has(p.id)) return false;
    const lastSeen = activeSenders[p.id];
    return !lastSeen || lastSeen < cutoff;
  });
  if (!inactive.length) return send(sock, from, msg, `✅ No inactive members to kick (>${days} days inactive).`);
  await send(sock, from, msg, `⏳ Kicking *${inactive.length}* inactive members (inactive > ${days} days)...`);
  let kicked = 0;
  for (const p of inactive) {
    try {
      await sock.groupParticipantsUpdate(from, [p.id], 'remove');
      kicked++;
      await new Promise(r => setTimeout(r, 800));
    } catch {}
  }
  await send(sock, from, msg, `✅ Kicked *${kicked}* inactive members!`);
}

// ─── VCF EXPORT ──────────────────────────────────────────────────────────────

async function vcf(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const metadata = await sock.groupMetadata(from);
  const members = metadata.participants;
  let vcfContent = '';
  for (const m of members) {
    const num = m.id.split('@')[0];
    const name = `+${num}`;
    vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL:+${num}\nEND:VCARD\n`;
  }
  const buf = Buffer.from(vcfContent, 'utf8');
  const filename = `${metadata.subject.replace(/[^a-zA-Z0-9]/g, '_')}_contacts.vcf`;
  await sock.sendMessage(from, {
    document: buf,
    mimetype: 'text/x-vcard',
    fileName: filename,
    caption: `📇 *${metadata.subject}*\n👥 ${members.length} contacts exported`
  }, { quoted: msg });
}

// ─── USER ID ─────────────────────────────────────────────────────────────────

async function userid(ctx) {
  const { sock, from, msg, sender } = ctx;
  const target = getMentioned(msg) || sender;
  const num = target.split('@')[0];
  await send(sock, from, msg, `🆔 *User ID*\n\n👤 @${num}\n📱 *Number:* +${num}\n🔑 *JID:* ${target}`, { mentions: [target] });
}

// ─── MEDIA TAG ───────────────────────────────────────────────────────────────

async function mediatag(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const val = args[0]?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '❌ Usage: .mediatag on/off\n\nWhen ON: sends @all tag whenever someone posts media in the group.');
  db.setGroup(from, { mediatag: val === 'on' ? 1 : 0 });
  await send(sock, from, msg, val === 'on' ? '✅ *Media Tag: ON*\n\n📸 All members will be tagged whenever media is posted.' : '🔴 *Media Tag: OFF*');
}

// ─── SCHEDULED OPEN/CLOSE ────────────────────────────────────────────────────

async function closetime(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  if (!text) return send(sock, from, msg, '⏰ *Schedule Group Close*\n\nUsage: .closetime <delay>\nExample: .closetime 30m\n\nSupports: s/m/h/d — e.g. 1h, 30m, 2d');
  const parseDelay = str => { const m = str.match(/^(\d+)(s|m|h|d)$/i); if (!m) return null; return parseInt(m[1]) * { s:1000,m:60000,h:3600000,d:86400000 }[m[2].toLowerCase()]; };
  const delay = parseDelay(text.trim());
  if (!delay) return send(sock, from, msg, '❌ Invalid time format. Examples: 30m, 1h, 2d');
  await send(sock, from, msg, `⏰ Group will be *closed* (muted) in *${text}*...`);
  setTimeout(async () => {
    try {
      await sock.groupSettingUpdate(from, 'announcement');
      await sendFireboxCard(sock, from, null, { title: '🔕 Group Closed', content: 'Group has been automatically closed.\nOnly admins can now send messages.', noQuote: true });
    } catch {}
  }, delay);
}

async function opentime(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  if (!text) return send(sock, from, msg, '⏰ *Schedule Group Open*\n\nUsage: .opentime <delay>\nExample: .opentime 2h\n\nSupports: s/m/h/d');
  const parseDelay = str => { const m = str.match(/^(\d+)(s|m|h|d)$/i); if (!m) return null; return parseInt(m[1]) * { s:1000,m:60000,h:3600000,d:86400000 }[m[2].toLowerCase()]; };
  const delay = parseDelay(text.trim());
  if (!delay) return send(sock, from, msg, '❌ Invalid time format. Examples: 30m, 1h, 2d');
  await send(sock, from, msg, `⏰ Group will be *opened* in *${text}*...`);
  setTimeout(async () => {
    try {
      await sock.groupSettingUpdate(from, 'not_announcement');
      await sendFireboxCard(sock, from, null, { title: '🔔 Group Opened', content: 'Group is now open!\nAll members can send messages.', noQuote: true });
    } catch {}
  }, delay);
}

// ─── ANNOUNCEMENTS MODE ──────────────────────────────────────────────────────

async function announcements(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  if (!await requireBotAdmin(ctx, admins)) return;
  const val = args[0]?.toLowerCase();
  if (val !== 'on' && val !== 'off') return send(sock, from, msg, '📢 Usage: .announcements on/off\n\nON = Only admins can message (announcement mode)\nOFF = Everyone can send messages');
  try {
    await sock.groupSettingUpdate(from, val === 'on' ? 'announcement' : 'not_announcement');
    await send(sock, from, msg, val === 'on' ? '📢 *Announcements Mode: ON*\n\n🔕 Only admins can now send messages.' : '💬 *Announcements Mode: OFF*\n\n✅ All members can now send messages.');
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── CANCEL KICK ─────────────────────────────────────────────────────────────

const pendingKicks = new Map();

async function cancelkick(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const key = `${from}`;
  const pending = pendingKicks.get(key);
  if (!pending) return send(sock, from, msg, '❌ No pending kick operation to cancel.');
  clearTimeout(pending.timer);
  pendingKicks.delete(key);
  await send(sock, from, msg, `✅ Cancelled pending kick of *${pending.count}* members.`);
}

// ─── EDIT SETTINGS ───────────────────────────────────────────────────────────

async function editsettings(ctx) {
  const { sock, from, msg } = ctx;
  if (!await requireGroup(ctx)) return;
  const admins = await requireAdmin(ctx);
  if (!admins) return;
  const grp = db.getGroup(from);
  const flags = [
    ['antilink', 'Anti-Link'],
    ['antibadword', 'Anti-Bad Word'],
    ['anticall', 'Anti-Call'],
    ['antibot', 'Anti-Bot'],
    ['antiforeign', 'Anti-Foreign'],
    ['antiforward', 'Anti-Forward'],
    ['antigroupmention', 'Anti-Group Mention'],
    ['antisticker', 'Anti-Sticker'],
    ['antimessage', 'Anti-Message'],
    ['welcome', 'Welcome/Goodbye'],
    ['mediatag', 'Media Tag'],
  ];
  const lines = flags.map(([k, label]) => `${grp[k] ? '✅' : '❌'} ${label}`).join('\n');
  await send(sock, from, msg,
    `⚙️ *Group Settings: ${(await sock.groupMetadata(from).catch(() => ({ subject: 'this group' }))).subject}*\n\n${lines}\n\n` +
    `_Use individual commands to toggle each setting._\n` +
    `Example: \`.antilink on\` \`.antibadword off\``
  );
}

// ─── FETCH ALL GROUPS ────────────────────────────────────────────────────────

async function fetchgroups(ctx) {
  const { sock, from, msg, isOwner } = ctx;
  if (!isOwner) return send(sock, from, msg, '❌ Owner only!');
  await send(sock, from, msg, '🔍 Fetching all groups...');
  try {
    const chats = await sock.groupFetchAllParticipating();
    const groups = Object.values(chats);
    if (!groups.length) return send(sock, from, msg, '📋 Bot is not in any groups.');
    const lines = groups.map((g, i) => `*${i + 1}.* ${g.subject}\n   👥 ${g.participants?.length || 0} members`).join('\n\n');
    const msg2 = `📋 *All Groups (${groups.length})*\n\n${lines}`;
    if (msg2.length > 3800) {
      const chunks = [];
      for (let i = 0; i < groups.length; i += 15) {
        const chunk = groups.slice(i, i + 15).map((g, j) => `*${i + j + 1}.* ${g.subject} (${g.participants?.length || 0})`).join('\n');
        chunks.push(chunk);
      }
      for (const chunk of chunks) await sock.sendMessage(from, { text: `📋 *Groups:*\n\n${chunk}` }, { quoted: msg });
    } else {
      await send(sock, from, msg, msg2);
    }
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

async function tosgroup(ctx) {
  const { sock, from, msg, text, isOwner } = ctx;
  if (!isOwner) return send(sock, from, msg, '❌ Owner only!');
  if (!text) return send(sock, from, msg, '📤 *Send to All Groups*\n\nUsage: .tosgroup <message>\n\nSends the message to all groups the bot is in.');
  await send(sock, from, msg, '📤 Sending message to all groups...');
  try {
    const chats = await sock.groupFetchAllParticipating();
    const groups = Object.values(chats);
    let sent = 0;
    for (const g of groups) {
      try {
        await sock.sendMessage(g.id, { text });
        sent++;
        await new Promise(r => setTimeout(r, 1000));
      } catch {}
    }
    await send(sock, from, msg, `✅ Message sent to *${sent}/${groups.length}* groups!`);
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── EVENT CHECKERS ───────────────────────────────────────────────────────────

async function checkAntiForward(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antiforward) return;
  const body = msg.message;
  if (!body) return;
  const msgType = Object.keys(body)[0];
  const msgContent = body[msgType];
  if (!msgContent?.contextInfo?.isForwarded && !msgContent?.contextInfo?.forwardingScore) return;
  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;
    const allowed = (grp.allowedUsers || []);
    if (allowed.includes(sender)) return;
    await sock.sendMessage(from, { delete: msg.key });
    await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]}, forwarded messages are not allowed here!`, mentions: [sender] });
  } catch (err) { console.error('[ANTIFORWARD]', err.message); }
}

async function checkAntiSticker(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antisticker) return;
  if (!msg.message?.stickerMessage) return;
  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;
    const allowed = (grp.allowedUsers || []);
    if (allowed.includes(sender)) return;
    await sock.sendMessage(from, { delete: msg.key });
  } catch (err) { console.error('[ANTISTICKER]', err.message); }
}

async function checkAntiGroupMention(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antigroupmention) return;
  const body = msg.message;
  if (!body) return;
  const msgType = Object.keys(body)[0];
  const msgContent = body[msgType];
  if (!msgContent?.contextInfo?.groupMentions?.length && !msgContent?.contextInfo?.mentionedJid?.length) return;
  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;
    await sock.sendMessage(from, { delete: msg.key });
    await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]}, group mentions are not allowed!`, mentions: [sender] });
  } catch (err) { console.error('[ANTIGROUPMENTION]', err.message); }
}

async function checkAntiMessage(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antimessage) return;
  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;
    const allowed = (grp.allowedUsers || []);
    if (allowed.includes(sender)) return;
    await sock.sendMessage(from, { delete: msg.key });
  } catch (err) { console.error('[ANTIMESSAGE]', err.message); }
}

async function checkAntiLinkGc(sock, msg, from, sender, isOwner) {
  const grp = db.getGroup(from);
  if (!grp.antilinkgc) return;
  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
  if (!body.match(/chat\.whatsapp\.com\/[a-zA-Z0-9]+/i)) return;
  try {
    const admins = await getAdmins(sock, from);
    if (admins.includes(sender) || isOwner) return;
    await sock.sendMessage(from, { delete: msg.key });
    await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]}, group invite links are not allowed here!`, mentions: [sender] });
  } catch (err) { console.error('[ANTILINKGC]', err.message); }
}

function trackActivity(from, sender) {
  try {
    const grp = db.getGroup(from);
    const senders = grp.activeSenders || {};
    senders[sender] = Date.now();
    db.setGroup(from, { activeSenders: senders });
  } catch {}
}

module.exports = {
  kick, add, promote, demote, kickall,
  mute, unmute, setgroupname, setdesc,
  link, resetlink,
  tagall, hidetag, tagadmin, totalmembers,
  poll,
  warn, listwarn, resetwarn,
  antiban, antilink, anticall,
  antibadword, addword, removeword, listwords,
  welcome, setwelcome, setgoodbye,
  groupinfo,
  antibot, antidemote, antiforeign, antiforward, antigroupmention,
  antilinkgc, antimessage, antisticker, antitag, antitagadmin,
  listrequests, approve, approveall, reject, disapproveall,
  addcode, delcode, listcode,
  allow, delallowed, listallowed,
  getgrouppp, setppgroup, delppgroup,
  listactive, listinactive, kickinactive,
  vcf, userid, mediatag,
  closetime, opentime, announcements, cancelkick, editsettings,
  fetchgroups, tosgroup,
  checkAntiLink, checkBadWord, handleGroupParticipantUpdate,
  checkAntiForward, checkAntiSticker, checkAntiGroupMention,
  checkAntiMessage, checkAntiLinkGc, trackActivity
};
