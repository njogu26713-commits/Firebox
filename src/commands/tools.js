const axios = require('axios');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { getContentType, downloadContentFromMessage } = require('@whiskeysockets/baileys');

const TMP = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const { sendFireboxCard } = require('../card');

// Recursively unwrap common message containers to find view-once content
function extractViewOnce(m) {
  if (!m) return null;
  const direct =
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.viewOnceMessageV2Extension?.message;
  if (direct) return direct;
  if (m.ephemeralMessage?.message) return extractViewOnce(m.ephemeralMessage.message);
  if (m.deviceSentMessage?.message) return extractViewOnce(m.deviceSentMessage.message);
  return null;
}

async function send(sock, from, msg, text, title) {
  return sendFireboxCard(sock, from, msg, { title: title || '🛠️ Firebox Tools', content: text });
}

async function qrcode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📲 Usage: .qrcode <text or URL>\nExample: .qrcode https://google.com', '📲 QR Code');
  try {
    const outPath = path.join(TMP, `qr_${Date.now()}.png`);
    await QRCode.toFile(outPath, text, { width: 512, margin: 2 });
    const buffer = fs.readFileSync(outPath);
    fs.unlinkSync(outPath);
    await sendFireboxCard(sock, from, msg, {
      title: '📲 QR Code Generated',
      content: `📝 *Content:* ${text}`,
      media: { type: 'image', buffer, mimetype: 'image/png' },
    });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to generate QR: ${err.message}`, '📲 QR Code');
  }
}

async function tinyurl(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔗 Usage: .tinyurl <URL>\nExample: .tinyurl https://very-long-url.com/path');
  try {
    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`, { timeout: 10000 });
    await send(sock, from, msg, `🔗 *URL Shortened*\n\n📎 Original: ${text}\n✅ Short: ${res.data}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to shorten URL.`);
  }
}

async function fancy(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '✨ Usage: .fancy <text>\nExample: .fancy Firebox');

  const transforms = {
    'Bold':       t => t.split('').map(c => {
      const n = c.charCodeAt(0);
      if (n >= 65 && n <= 90) return String.fromCodePoint(n + 119743);
      if (n >= 97 && n <= 122) return String.fromCodePoint(n + 119737);
      return c;
    }).join(''),
    'Italic':     t => t.split('').map(c => {
      const n = c.charCodeAt(0);
      if (n >= 65 && n <= 90) return String.fromCodePoint(n + 119795);
      if (n >= 97 && n <= 122) return String.fromCodePoint(n + 119789);
      return c;
    }).join(''),
    'Bubble':     t => t.split('').map(c => {
      const n = c.charCodeAt(0);
      if (n >= 65 && n <= 90) return String.fromCodePoint(n + 9333);
      if (n >= 97 && n <= 122) return String.fromCodePoint(n + 9327);
      if (n >= 48 && n <= 57) return ['⓪','①','②','③','④','⑤','⑥','⑦','⑧','⑨'][n - 48];
      return c;
    }).join(''),
    'Squares':    t => t.split('').map(c => {
      const n = c.charCodeAt(0);
      if (n >= 65 && n <= 90) return String.fromCodePoint(n + 127280);
      return c;
    }).join(''),
    'Small Caps': t => t.toLowerCase().split('').map(c => 'abcdefghijklmnopqrstuvwxyz'.includes(c) ? 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ'['abcdefghijklmnopqrstuvwxyz'.indexOf(c)] : c).join(''),
    'Upside Down': t => t.split('').reverse().map(c => ({a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'l',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z'}[c.toLowerCase()] || c)).join('')
  };

  let result = `✨ *Fancy Text: "${text}"*\n\n`;
  for (const [name, fn] of Object.entries(transforms)) {
    result += `*${name}:* ${fn(text)}\n`;
  }
  await send(sock, from, msg, result);
}

async function genpass(ctx) {
  const { sock, from, msg, args } = ctx;
  const len = parseInt(args[0]) || 16;
  if (len < 4 || len > 64) return send(sock, from, msg, '❌ Length must be between 4 and 64.');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';
  let pass = '';
  for (let i = 0; i < len; i++) pass += chars[Math.floor(Math.random() * chars.length)];
  await send(sock, from, msg, `🔑 *Generated Password*\n\n\`${pass}\`\n\n📏 Length: ${len} characters\n⚠️ _Do not share this password with anyone!_`);
}

async function calculate(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🧮 Usage: .calculate <math expression>\nExample: .calculate (25 * 4) + 100 / 2');
  try {
    const safe = text.replace(/[^0-9+\-*/().%\s]/g, '');
    if (!safe.trim()) return send(sock, from, msg, '❌ Invalid expression. Only numbers and operators allowed.');
    // eslint-disable-next-line no-new-func
    const result = Function(`'use strict'; return (${safe})`)();
    if (!isFinite(result)) return send(sock, from, msg, '❌ Result is not a valid number.');
    await send(sock, from, msg, `🧮 *Calculator*\n\n📝 Expression: \`${text}\`\n✅ Result: *${result}*`);
  } catch (err) {
    await send(sock, from, msg, `❌ Invalid expression: ${err.message}`);
  }
}

async function getpp(ctx) {
  const { sock, from, msg, args } = ctx;

  // Extract context info from any message type
  const m = msg.message || {};
  const ctxInfo =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    m.buttonsResponseMessage?.contextInfo ||
    m.listResponseMessage?.contextInfo;

  // Priority: quoted participant (groups) → quoted remoteJid (DMs) → @mention → typed number
  // Only ever accept @s.whatsapp.net JIDs — never group JIDs (@g.us)
  const isUser = j => typeof j === 'string' && j.endsWith('@s.whatsapp.net');

  const quotedParticipant = isUser(ctxInfo?.participant) ? ctxInfo.participant
    : isUser(ctxInfo?.remoteJid)                         ? ctxInfo.remoteJid
    : null;

  const mentionedJid = ctxInfo?.mentionedJid?.find(isUser);
  const typedNumber  = args[0] ? args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : null;

  const target = quotedParticipant || mentionedJid || typedNumber;

  if (!target) {
    return send(sock, from, msg,
      '🖼️ *Usage:* `.getpp @user` or reply to their message with `.getpp`');
  }

  // Normalise JID — strip any device suffix (:0, :1, etc.)
  const jid = target.replace(/:\d+@/, '@');

  try {
    const ppUrl = await sock.profilePictureUrl(jid, 'image');
    if (!ppUrl || typeof ppUrl !== 'string' || !ppUrl.startsWith('http')) {
      return send(sock, from, msg, '❌ That user has no profile picture set.');
    }
    const res = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 15000 });
    await sendFireboxCard(sock, from, msg, {
      title: '🖼️ Profile Picture',
      content: `📱 *Number:* @${jid.split('@')[0]}`,
      media: { type: 'image', buffer: Buffer.from(res.data), mimetype: 'image/jpeg' },
      mentions: [jid],
    });
  } catch (err) {
    const msg2 = err.message || '';
    const reason = msg2.includes('not-authorized') || msg2.includes('404')
      ? 'Their privacy settings block profile picture access.'
      : msg2.includes('item-not-found')
        ? 'That number is not on WhatsApp or has no profile picture set.'
        : msg2.includes('timed') || msg2.includes('timeout')
          ? 'Request timed out. Try again.'
          : `Could not fetch picture (${msg2})`;
    await send(sock, from, msg, `❌ ${reason}`, '🖼️ Profile Picture');
  }
}

async function time(ctx) {
  const { sock, from, msg, text } = ctx;
  const tz = text || 'Africa/Nairobi';
  try {
    const now = new Date().toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
    await send(sock, from, msg, `🕐 *Current Time*\n\n🌍 Timezone: ${tz}\n📅 ${now}`);
  } catch {
    const now = new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
    await send(sock, from, msg, `🕐 *Current Time*\n\n📅 ${now}`);
  }
}

async function emojimix(ctx) {
  const { sock, from, msg, args } = ctx;
  if (args.length < 2) return send(sock, from, msg, '🎭 Usage: .emojimix 😀 😎\nExample: .emojimix 🔥 💧', '🎭 Emoji Mix');
  const e1 = encodeURIComponent(args[0]);
  const e2 = encodeURIComponent(args[1]);
  try {
    const url = `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/${e1}/${e1}_${e2}.png`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    await sendFireboxCard(sock, from, msg, {
      title: '🎭 Emoji Mix',
      content: `${args[0]} + ${args[1]} = magic! ✨`,
      media: { type: 'image', buffer: Buffer.from(res.data), mimetype: 'image/png' },
    });
  } catch {
    await send(sock, from, msg, `❌ Could not mix those emojis. Try different ones!`, '🎭 Emoji Mix');
  }
}

async function tourl(ctx) {
  const { sock, from, msg } = ctx;
  const FormData = require('form-data');

  const contextInfo =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo;

  const quoted = contextInfo?.quotedMessage;
  if (!quoted) return send(sock, from, msg,
    '🔗 *Usage:* Reply to any media (image/video/audio/document) with `.tourl`\n\n_Uploads it and sends back a public URL._'
  );

  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  const mediaType = mediaTypes.find(t => quoted[t]);
  if (!mediaType) return send(sock, from, msg, '❌ No media found in the quoted message. Reply to an image, video, audio, or document.');

  await send(sock, from, msg, '📤 Uploading media, please wait...');

  try {
    const qCtx = msg.message.extendedTextMessage?.contextInfo || contextInfo;
    const fakeMsg = {
      key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant },
      message: quoted
    };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);

    const mime = quoted[mediaType]?.mimetype || 'application/octet-stream';
    const ext = mime.split('/')[1]?.split(';')[0] || 'bin';
    const filename = `firebox_${Date.now()}.${ext}`;

    // Try transfer.sh first
    let url = null;
    try {
      const res = await axios.put(`https://transfer.sh/${filename}`, buf, {
        headers: { 'Content-Type': mime, 'Max-Days': '7' },
        timeout: 30000,
        maxBodyLength: Infinity
      });
      url = typeof res.data === 'string' ? res.data.trim() : null;
    } catch {}

    // Fallback: 0x0.st
    if (!url) {
      try {
        const form = new FormData();
        form.append('file', buf, { filename, contentType: mime });
        const res2 = await axios.post('https://0x0.st', form, {
          headers: form.getHeaders(),
          timeout: 30000,
          maxBodyLength: Infinity
        });
        url = typeof res2.data === 'string' ? res2.data.trim() : null;
      } catch {}
    }

    if (!url) throw new Error('All upload services failed. Try again later.');

    const sizeKb = (buf.length / 1024).toFixed(1);
    await send(sock, from, msg,
      `🔗 *Media URL Generated*\n\n` +
      `📎 *URL:* ${url}\n` +
      `📦 *Size:* ${sizeKb} KB\n` +
      `🗂️ *Type:* ${mime}\n\n` +
      `_Link valid for 7 days. Use .tinyurl to shorten it._`
    );
  } catch (err) {
    await send(sock, from, msg, `❌ Upload failed: ${err.message}`);
  }
}

async function viewonce(ctx) {
  const { sock, from, msg, sessionState } = ctx;

  const contextInfo =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo;

  const quotedId = contextInfo?.stanzaId;

  if (!quotedId) {
    return sock.sendMessage(from, {
      text: '👁️ *Usage:* Reply to a view-once photo or video with *.vv*\n\n_Make sure you are replying directly to the view-once message._'
    }, { quoted: msg });
  }

  const cached = sessionState.viewOnceCache.get(quotedId);

  if (!cached?.buffer) {
    return sock.sendMessage(from, {
      text: '❌ Could not find that view-once media.\n\n_Possible reasons:_\n• The media expired (cache lasts 10 min)\n• The message was sent before the bot started\n• It is not a view-once message\n\n_Tip: Ask them to resend it so the bot can catch it._'
    }, { quoted: msg });
  }

  const { buffer, type, sender, mimetype, ptt } = cached;
  const senderTag = sender ? `@${sender.split('@')[0]}` : 'someone';
  const caption = `👁️ *View-once revealed*\n📩 Sent by: ${senderTag}`;

  try {
    if (type === 'imageMessage') {
      await sock.sendMessage(from, {
        image: buffer,
        caption,
        mimetype: mimetype || 'image/jpeg',
        ...(sender ? { mentions: [sender] } : {})
      }, { quoted: msg });
    } else if (type === 'videoMessage') {
      await sock.sendMessage(from, {
        video: buffer,
        caption,
        mimetype: mimetype || 'video/mp4',
        ...(sender ? { mentions: [sender] } : {})
      }, { quoted: msg });
    } else {
      await sock.sendMessage(from, {
        audio: buffer,
        mimetype: mimetype || 'audio/mp4',
        ptt: ptt || false
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('[VV]', err.message);
    await sock.sendMessage(from, {
      text: `❌ Failed to send view-once media: ${err.message}`
    }, { quoted: msg });
  }
}

// Rate limit: max 5 anon messages per sender per hour
const anonRateLimit = new Map();

function checkAnonLimit(sender) {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const MAX = 5;
  const entry = anonRateLimit.get(sender) || { count: 0, resetAt: now + HOUR };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + HOUR;
  }
  if (entry.count >= MAX) return false;
  entry.count++;
  anonRateLimit.set(sender, entry);
  return true;
}

async function anon(ctx) {
  const { sock, from, msg, args, sender } = ctx;

  const senderJid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
  const isGroup = from.endsWith('@g.us');

  // Helper: silently delete the sender's command message so no one in the group sees it
  async function deleteCommandMsg() {
    if (!isGroup) return;
    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: false,
          id: msg.key.id,
          participant: msg.key.participant || sender
        }
      });
    } catch (_) {}
    // Also let bot delete its own copy if needed
    try {
      await sock.chatModify({ clear: { messages: [{ id: msg.key.id, fromMe: false, timestamp: msg.messageTimestamp }] } }, from);
    } catch (_) {}
  }

  if (args.length < 2) {
    await deleteCommandMsg();
    return sock.sendMessage(senderJid, {
      text: '🕵️ *Anonymous Message*\n\n*Usage:* .anon <number> <message>\n\n*Example:*\n.anon 254712345678 Hey, just wanted to say hi! 👋\n\n_• Number without + or spaces_\n_• Recipient sees it came from this bot, not you_\n_• Max 5 messages per hour_\n_• Use in DM for full privacy_'
    });
  }

  const rawNumber = args[0].replace(/[^0-9]/g, '');

  // Delete command from group ASAP — before any processing delays
  await deleteCommandMsg();

  if (rawNumber.length < 7 || rawNumber.length > 15) {
    return sock.sendMessage(senderJid, { text: '❌ Invalid phone number. Use digits only, no + or spaces.\nExample: 254712345678' });
  }

  const targetJid = `${rawNumber}@s.whatsapp.net`;
  const message = args.slice(1).join(' ').trim();

  if (!message) return sock.sendMessage(senderJid, { text: '❌ Please include a message to send.' });
  if (message.length > 500) return sock.sendMessage(senderJid, { text: '❌ Message too long. Max 500 characters.' });

  if (!checkAnonLimit(sender)) {
    return sock.sendMessage(senderJid, { text: '⏳ Rate limit reached. You can send max 5 anonymous messages per hour.' });
  }

  try {
    // Check if number exists on WhatsApp
    const [result] = await sock.onWhatsApp(targetJid);
    if (!result?.exists) {
      return sock.sendMessage(senderJid, { text: '❌ That number is not on WhatsApp.' });
    }

    // Send anon message to recipient's DM — from the bot, no sender info
    await sock.sendMessage(targetJid, {
      text: `🕵️ *Anonymous Message*\n\n${message}\n\n_Someone sent you this anonymously via Firebox Bot. Their identity is hidden._`
    });

    // Confirm only in sender's private DM
    await sock.sendMessage(senderJid, {
      text: `✅ *Anonymous message sent!*\n\n📱 To: +${rawNumber}\n📝 "${message.slice(0, 60)}${message.length > 60 ? '...' : ''}"\n\n_The recipient cannot see who you are._`
    });

    console.log(`[ANON] ${sender} → ${rawNumber}`);
  } catch (err) {
    await sock.sendMessage(senderJid, { text: `❌ Failed to send: ${err.message}` });
  }
}

// Rate limit: max 3 confessions per sender per day
const confessRateLimit = new Map();

function checkConfessLimit(sender) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const MAX = 3;
  const entry = confessRateLimit.get(sender) || { count: 0, resetAt: now + DAY };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + DAY; }
  if (entry.count >= MAX) return false;
  entry.count++;
  confessRateLimit.set(sender, entry);
  return true;
}

async function confess(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  const db = require('../database');

  const senderJid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
  const isGroup = from.endsWith('@g.us');

  // Delete command from group immediately so nobody sees who typed it
  async function deleteCommandMsg() {
    if (!isGroup) return;
    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: false,
          id: msg.key.id,
          participant: msg.key.participant || sender
        }
      });
    } catch (_) {}
  }

  await deleteCommandMsg();

  if (!text) {
    return sock.sendMessage(senderJid, {
      text: '🤫 *Anonymous Confession*\n\n*Usage:* .confess <your confession>\n\n*Example:*\n.confess I have a crush on someone in this group 😳\n\n_Your identity is completely hidden. Max 3 confessions per day._'
    });
  }

  if (text.length > 600) return sock.sendMessage(senderJid, { text: '❌ Confession too long. Max 600 characters.' });

  if (!checkConfessLimit(sender)) {
    return sock.sendMessage(senderJid, { text: '⏳ You have reached the limit of 3 confessions per day. Try again tomorrow.' });
  }

  const id = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  const ownerJid = (process.env.OWNER_NUMBER || '') + '@s.whatsapp.net';

  db.addConfession({ id, message: text, receivedAt: Date.now(), chat: from });

  // Notify owner
  if (ownerJid !== '@s.whatsapp.net') {
    try {
      await sock.sendMessage(ownerJid, {
        text: `📬 *New Confession Received!*\n\n🆔 ID: \`${id}\`\n\n💬 "${text}"\n\n_Use .sharecf ${id} to share it or .clearcf ${id} to delete it_`
      });
    } catch (_) {}
  }

  // Confirm privately in sender's DM only
  await sock.sendMessage(senderJid, {
    text: `✅ *Confession submitted!*\n\n🤫 Your identity is completely hidden.\n_The owner will review and may share it anonymously._`
  });
}

async function reverse(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔄 Usage: .reverse <text>\nExample: .reverse Hello World');
  const rev = text.split('').reverse().join('');
  await send(sock, from, msg, `🔄 *Reversed*\n\n📝 Original: ${text}\n✅ Result: ${rev}`);
}

async function wordcount(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📊 Usage: .wordcount <text>');
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  const sentences = (text.match(/[.!?]+/g) || []).length;
  await send(sock, from, msg, `📊 *Word Count*\n\n📝 Words: *${words}*\n🔤 Characters: *${chars}*\n🔡 Characters (no spaces): *${charsNoSpace}*\n📄 Sentences: *${sentences}*`);
}

const MORSE = {
  a:'.-', b:'-...', c:'-.-.', d:'-..', e:'.', f:'..-.', g:'--.', h:'....', i:'..', j:'.---',
  k:'-.-', l:'.-..', m:'--', n:'-.', o:'---', p:'.--.', q:'--.-', r:'.-.', s:'...', t:'-',
  u:'..-', v:'...-', w:'.--', x:'-..-', y:'-.--', z:'--..',
  '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.'
};
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k,v])=>[v,k]));

async function morse(ctx) {
  const { sock, from, msg, args, text } = ctx;
  const mode = args[0]?.toLowerCase();
  const input = args.slice(1).join(' ');
  if (!mode || !input || !['encode','decode'].includes(mode))
    return send(sock, from, msg, '📡 Usage:\n.morse encode <text>\n.morse decode <morse>\n\nExample:\n.morse encode hello\n.morse decode .... . .-.. .-.. ---');
  if (mode === 'encode') {
    const encoded = input.toLowerCase().split('').map(c => c === ' ' ? '/' : (MORSE[c] || c)).join(' ');
    await send(sock, from, msg, `📡 *Morse Encode*\n\n📝 Input: ${input}\n✅ Morse: ${encoded}`);
  } else {
    const decoded = input.split(' / ').map(word =>
      word.split(' ').map(sym => MORSE_REV[sym] || '?').join('')
    ).join(' ');
    await send(sock, from, msg, `📡 *Morse Decode*\n\n📟 Input: ${input}\n✅ Result: ${decoded.toUpperCase()}`);
  }
}

async function binary(ctx) {
  const { sock, from, msg, args, text } = ctx;
  const mode = args[0]?.toLowerCase();
  const input = args.slice(1).join(' ');
  if (!mode || !input || !['encode','decode'].includes(mode))
    return send(sock, from, msg, '💾 Usage:\n.binary encode <text>\n.binary decode <binary>\n\nExample:\n.binary encode Hi\n.binary decode 01001000 01101001');
  if (mode === 'encode') {
    const encoded = input.split('').map(c => c.charCodeAt(0).toString(2).padStart(8,'0')).join(' ');
    await send(sock, from, msg, `💾 *Binary Encode*\n\n📝 Input: ${input}\n✅ Binary: ${encoded}`);
  } else {
    try {
      const decoded = input.split(' ').map(b => String.fromCharCode(parseInt(b, 2))).join('');
      await send(sock, from, msg, `💾 *Binary Decode*\n\n📟 Input: ${input}\n✅ Result: ${decoded}`);
    } catch {
      await send(sock, from, msg, '❌ Invalid binary string. Make sure it\'s 8-bit groups separated by spaces.');
    }
  }
}

async function repeat(ctx) {
  const { sock, from, msg, args } = ctx;
  const n = parseInt(args[0]);
  const txt = args.slice(1).join(' ');
  if (!n || !txt || n < 1 || n > 20) return send(sock, from, msg, '🔁 Usage: .repeat <1-20> <text>\nExample: .repeat 3 Hello!');
  await send(sock, from, msg, `🔁 *Repeat x${n}*\n\n${Array(n).fill(txt).join('\n')}`);
}

async function age(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎂 Usage: .age <DD/MM/YYYY>\nExample: .age 15/08/1998');
  const parts = text.split(/[\/\-\.]/);
  if (parts.length !== 3) return send(sock, from, msg, '❌ Use format DD/MM/YYYY');
  const [d, m, y] = parts.map(Number);
  const dob = new Date(y, m - 1, d);
  if (isNaN(dob)) return send(sock, from, msg, '❌ Invalid date.');
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  let days = now.getDate() - dob.getDate();
  if (days < 0) { months--; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (months < 0) { years--; months += 12; }
  const totalDays = Math.floor((now - dob) / 86400000);
  await send(sock, from, msg, `🎂 *Age Calculator*\n\n📅 Birthday: ${text}\n\n🎉 Age: *${years} years, ${months} months, ${days} days*\n📆 Total days lived: *${totalDays.toLocaleString()}*`);
}

async function countdown(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '⏳ Usage: .countdown <DD/MM/YYYY>\nExample: .countdown 31/12/2025');
  const parts = text.split(/[\/\-\.]/);
  if (parts.length !== 3) return send(sock, from, msg, '❌ Use format DD/MM/YYYY');
  const [d, m, y] = parts.map(Number);
  const target = new Date(y, m - 1, d);
  if (isNaN(target)) return send(sock, from, msg, '❌ Invalid date.');
  const diff = target - new Date();
  if (diff < 0) return send(sock, from, msg, '❌ That date has already passed!');
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  await send(sock, from, msg, `⏳ *Countdown*\n\n📅 Target: ${text}\n\n⏱️ *${days}* days, *${hours}* hours, *${minutes}* minutes remaining`);
}

async function rps(ctx) {
  const { sock, from, msg, text } = ctx;
  const choices = ['rock', 'paper', 'scissors'];
  const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
  const player = text?.toLowerCase().trim();
  if (!choices.includes(player)) return send(sock, from, msg, '✂️ Usage: .rps <rock/paper/scissors>');
  const bot = choices[Math.floor(Math.random() * 3)];
  let result;
  if (player === bot) result = '🤝 *It\'s a draw!*';
  else if ((player==='rock'&&bot==='scissors')||(player==='paper'&&bot==='rock')||(player==='scissors'&&bot==='paper')) result = '🏆 *You win!*';
  else result = '🤖 *Bot wins!*';
  await send(sock, from, msg, `✂️ *Rock Paper Scissors*\n\n👤 You: ${emojis[player]} ${player}\n🤖 Bot: ${emojis[bot]} ${bot}\n\n${result}`);
}

async function compliment(ctx) {
  const { sock, from, msg } = ctx;
  const list = [
    "You light up every room you walk into! ✨",
    "Your smile could cure a bad day. 😊",
    "You have an amazing ability to make people feel valued. 💛",
    "You're more talented than you realize. 🌟",
    "The world is genuinely better with you in it. 🌍",
    "You're incredibly strong, even when it doesn't feel that way. 💪",
    "Your kindness doesn't go unnoticed. 🤍",
    "You inspire people without even trying. 🔥",
    "You have a brilliant mind. 🧠",
    "Anyone lucky enough to know you is truly blessed. 🙏"
  ];
  await send(sock, from, msg, `💐 *Compliment*\n\n${list[Math.floor(Math.random()*list.length)]}`);
}

async function roast(ctx) {
  const { sock, from, msg } = ctx;
  const list = [
    "I'd roast you, but my mom said I'm not allowed to burn trash. 🗑️",
    "You're proof that even evolution makes mistakes. 😂",
    "If brains were petrol, you wouldn't have enough to power an ant's scooter. 🛵",
    "I've seen sharper edges on a ball. ⚽",
    "You're the human version of a participation trophy. 🏅",
    "I'd explain it to you but I left my crayons at home. 🖍️",
    "Some people bring happiness wherever they go. You bring it whenever you go. 👋",
    "I'd call you a clown, but clowns are at least entertaining. 🤡",
    "You have your entire life to be an idiot. Why rush? 🏃",
    "I'm not saying you're dumb, but you'd struggle to pour water out of a boot with instructions on the heel. 🥾"
  ];
  await send(sock, from, msg, `🔥 *Roast*\n\n${list[Math.floor(Math.random()*list.length)]}`);
}

async function wyr(ctx) {
  const { sock, from, msg } = ctx;
  const list = [
    ["be able to fly", "be invisible"],
    ["lose all your money", "lose all your memories"],
    ["only eat sweet food forever", "only eat spicy food forever"],
    ["never use social media again", "never watch TV/movies again"],
    ["always know when someone is lying", "always get away with lying"],
    ["be famous but hated", "unknown but loved"],
    ["have 10 true friends", "1 million fake ones"],
    ["live 200 years as an average person", "live 50 years as a legend"],
    ["always be overdressed", "always be underdressed"],
    ["speak every language", "play every instrument"]
  ];
  const [a, b] = list[Math.floor(Math.random()*list.length)];
  await send(sock, from, msg, `🤔 *Would You Rather?*\n\n🅰️ ${a}\n\n— or —\n\n🅱️ ${b}\n\n_Reply with A or B!_`);
}

const RIDDLES = [
  { q: "I have cities, but no houses live there. I have mountains, but no trees grow. I have water, but no fish swim. What am I?", a: "A map" },
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
  { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", a: "An echo" },
  { q: "What has hands but can't clap?", a: "A clock" },
  { q: "What gets wetter the more it dries?", a: "A towel" },
  { q: "I have keys but no locks. I have space but no room. You can enter, but can't go inside. What am I?", a: "A keyboard" },
  { q: "What can travel around the world while staying in a corner?", a: "A stamp" },
  { q: "The more you remove, the bigger I become. What am I?", a: "A hole" },
  { q: "I'm not alive but I can grow. I don't have lungs but I need air. What am I?", a: "Fire" },
  { q: "What has one eye but can't see?", a: "A needle" }
];

async function riddle(ctx) {
  const { sock, from, msg } = ctx;
  const r = RIDDLES[Math.floor(Math.random()*RIDDLES.length)];
  await send(sock, from, msg, `🧩 *Riddle*\n\n${r.q}\n\n||Answer: ${r.a}||`);
}

const activeGuessGames = new Map();

async function numguess(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  const key = `${from}_${sender}`;

  if (text?.toLowerCase() === 'start' || !activeGuessGames.has(key)) {
    const secret = Math.floor(Math.random() * 100) + 1;
    activeGuessGames.set(key, { secret, attempts: 0, max: 7 });
    return send(sock, from, msg, `🎮 *Number Guessing Game*\n\nI'm thinking of a number between *1 and 100*.\nYou have *7 attempts*. Type .guess <number> to guess!\n\nExample: .guess 50`);
  }

  const game = activeGuessGames.get(key);
  const guess = parseInt(text);
  if (isNaN(guess) || guess < 1 || guess > 100)
    return send(sock, from, msg, '❌ Guess a number between 1 and 100.\nExample: .guess 42');

  game.attempts++;
  const left = game.max - game.attempts;

  if (guess === game.secret) {
    activeGuessGames.delete(key);
    return send(sock, from, msg, `🎉 *Correct!* The number was *${game.secret}*!\nYou got it in *${game.attempts}* attempt${game.attempts!==1?'s':''}! 🏆`);
  }

  if (game.attempts >= game.max) {
    activeGuessGames.delete(key);
    return send(sock, from, msg, `💀 *Game over!* The number was *${game.secret}*.\nBetter luck next time! Type .guess start to play again.`);
  }

  const hint = guess < game.secret ? '📈 Too low!' : '📉 Too high!';
  await send(sock, from, msg, `${hint}\n\nAttempts left: *${left}*`);
}

// ── TEXT TO SPEECH ─────────────────────────────────────────────────────────────
const TTS_LANGS = {
  en: 'English', sw: 'Swahili', fr: 'French', es: 'Spanish',
  de: 'German', ar: 'Arabic', hi: 'Hindi', pt: 'Portuguese',
  zh: 'Chinese', it: 'Italian', ru: 'Russian', ja: 'Japanese',
  ko: 'Korean', tr: 'Turkish', nl: 'Dutch'
};

async function tts(ctx) {
  const { sock, from, msg, args } = ctx;
  if (!args.length) return send(sock, from, msg,
    `🔊 *Usage:* .tts <text>\n` +
    `🌐 *With language:* .tts <lang> <text>\n\n` +
    `*Supported languages:*\n` +
    Object.entries(TTS_LANGS).map(([k, v]) => `• ${k} — ${v}`).join('\n') +
    `\n\n*Examples:*\n• .tts Hello how are you\n• .tts sw Habari yako`);

  let lang = 'en';
  let phrase = args.join(' ');

  if (TTS_LANGS[args[0]?.toLowerCase()]) {
    lang = args[0].toLowerCase();
    phrase = args.slice(1).join(' ');
  }

  if (!phrase) return send(sock, from, msg, '❌ Please provide text after the language code.');
  if (phrase.length > 500) return send(sock, from, msg, '❌ Text too long. Maximum 500 characters.');

  try {
    await sock.sendPresenceUpdate('recording', from);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(phrase)}&tl=${lang}&client=tw-ob`;
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const buffer = Buffer.from(res.data);
    await sock.sendMessage(from, {
      audio: buffer,
      mimetype: 'audio/mpeg',
      ptt: true
    }, { quoted: msg });
  } catch (err) {
    await send(sock, from, msg, `❌ TTS failed: ${err.message}`);
  }
}

// ─── OCR — Read text from image ───────────────────────────────────────────────

async function readImage(ctx) {
  const { sock, from, msg, quoted } = ctx;

  const target = quoted ? { message: quoted.message } : msg;
  const type = getContentType(target.message);

  if (type !== 'imageMessage') {
    return send(sock, from, msg,
      'Reply to an image with *.read* and I\'ll extract any text from it.\n\n_Example: someone posts a screenshot → you reply with_ *.read*',
      '📷 Read Image Text'
    );
  }

  await send(sock, from, msg, '🔍 Reading text from image, please wait...', '📷 Read Image');

  const tmpPath = path.join(TMP, `ocr_${Date.now()}.jpg`);
  try {
    const media = target.message.imageMessage;
    const stream = await downloadContentFromMessage(media, 'image');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(tmpPath, buffer);

    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng', 1, {
      logger: () => {}
    });
    const { data: { text, confidence } } = await worker.recognize(tmpPath);
    await worker.terminate();

    const cleaned = text.trim();
    if (!cleaned) {
      return send(sock, from, msg, '❌ No readable text found in this image.', '📷 Read Image');
    }

    const conf = Math.round(confidence);
    await send(sock, from, msg,
      `📄 *Text extracted* _(${conf}% confidence)_\n\n${cleaned}`,
      '📷 Read Image Text'
    );

  } catch (err) {
    await send(sock, from, msg, `❌ OCR failed: ${err.message}`, '📷 Read Image');
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { qrcode, tinyurl, fancy, genpass, calculate, getpp, time, emojimix, viewonce, anon, confess, reverse, wordcount, morse, binary, repeat, age, countdown, rps, compliment, roast, wyr, riddle, numguess, tts, readImage };
