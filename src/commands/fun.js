const axios = require('axios');
const { sendFireboxCard } = require('../card');

async function send(sock, from, msg, text, title) {
  return sendFireboxCard(sock, from, msg, { title: title || '🎭 Firebox Fun', content: text });
}

// ── helper: extract tagged/quoted JID ────────────────────────────────────────
function getMentionedJid(ctx) {
  const { msg } = ctx;
  const m = msg?.message;
  const mentioned = m?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
    || m?.groupMentionedMessage?.contextInfo?.mentionedJid?.[0];
  const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedSender = m?.extendedTextMessage?.contextInfo?.participant;
  return mentioned || quotedSender || null;
}

function randomPct() { return Math.floor(Math.random() * 101); }

function loveBar(pct) {
  const filled = Math.round(pct / 10);
  return '❤️'.repeat(filled) + '🖤'.repeat(10 - filled);
}

// ── .bf / .gf ─────────────────────────────────────────────────────────────────
async function bf(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  const name = text || 'Mystery Person 💕';
  const pct = randomPct();
  const bar = loveBar(pct);
  const emoji = pct >= 80 ? '😍' : pct >= 60 ? '😊' : pct >= 40 ? '😐' : '😢';
  await send(sock, from, msg,
    `👤 *User:* @${sender.split('@')[0]}\n` +
    `💑 *BF:* ${name}\n\n` +
    `${bar}\n` +
    `💘 *Love:* ${pct}% ${emoji}\n\n` +
    `_${pct >= 80 ? 'Perfect match! 💍' : pct >= 60 ? 'Great couple! 💕' : pct >= 40 ? 'Could work with effort ✨' : 'Hmm... maybe not 😅'}_`,
    '💑 Boyfriend Meter');
}

async function gf(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  const name = text || 'Mystery Girl 💕';
  const pct = randomPct();
  const bar = loveBar(pct);
  const emoji = pct >= 80 ? '😍' : pct >= 60 ? '😊' : pct >= 40 ? '😐' : '😢';
  await send(sock, from, msg,
    `👤 *User:* @${sender.split('@')[0]}\n` +
    `💑 *GF:* ${name}\n\n` +
    `${bar}\n` +
    `💘 *Love:* ${pct}% ${emoji}\n\n` +
    `_${pct >= 80 ? 'Perfect match! 💍' : pct >= 60 ? 'Great couple! 💕' : pct >= 40 ? 'Could work with effort ✨' : 'Hmm... maybe not 😅'}_`,
    '💑 Girlfriend Meter');
}

// ── .couple ───────────────────────────────────────────────────────────────────
async function couple(ctx) {
  const { sock, from, msg, sender } = ctx;
  const mentioned = getMentionedJid(ctx);
  const partner = mentioned
    ? `@${mentioned.split('@')[0]}`
    : 'someone special 💕';
  const pct = randomPct();
  const bar = loveBar(pct);
  await send(sock, from, msg,
    `👫 *Couple Compatibility*\n\n` +
    `💙 @${sender.split('@')[0]}\n` +
    `❤️ ${partner}\n\n` +
    `${bar}\n` +
    `💘 *Score:* ${pct}%\n\n` +
    `_${pct >= 80 ? '👑 Soulmates!' : pct >= 60 ? '💕 Great together!' : pct >= 40 ? '✨ Worth a shot!' : '💀 Disaster incoming 😂'}_`,
    '💑 Couple Meter');
}

// ── .gay ──────────────────────────────────────────────────────────────────────
async function gay(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  const target = text || `@${sender.split('@')[0]}`;
  const pct = randomPct();
  const flags = pct >= 75 ? '🏳️‍🌈🏳️‍🌈🏳️‍🌈' : pct >= 50 ? '🏳️‍🌈🏳️‍🌈' : pct >= 25 ? '🏳️‍🌈' : '😐';
  await send(sock, from, msg,
    `🏳️‍🌈 *Gay Meter*\n\n` +
    `👤 *User:* ${target}\n\n` +
    `${'🌈'.repeat(Math.round(pct / 10))}${'⬛'.repeat(10 - Math.round(pct / 10))}\n` +
    `📊 *Score:* ${pct}% ${flags}\n\n` +
    `_This is just for fun — all love is valid! 🌈_`,
    '🏳️‍🌈 Gay Meter');
}

// ── .getjid ───────────────────────────────────────────────────────────────────
async function getjid(ctx) {
  const { sock, from, msg, sender } = ctx;
  const mentioned = getMentionedJid(ctx);
  const jid = mentioned || sender;
  const number = jid.split('@')[0];
  const type = jid.includes('g.us') ? '👥 Group' : '👤 User';
  await send(sock, from, msg,
    `🔍 *JID Lookup*\n\n` +
    `📋 *JID:* \`${jid}\`\n` +
    `📱 *Number:* ${number}\n` +
    `🏷️ *Type:* ${type}\n\n` +
    `_Tag someone or reply to a message to get their JID_`,
    '🔍 Get JID');
}

// ── .device ───────────────────────────────────────────────────────────────────
async function device(ctx) {
  const { sock, from, msg, sender } = ctx;
  const mentioned = getMentionedJid(ctx);
  const target = mentioned || sender;
  const number = target.split('@')[0];

  // Agent ID hints: 0=unknown, 1=web, 2=ios, 3=android, 4=desktop
  // Try to infer from message key device suffix
  const deviceId = msg?.key?.id?.length;
  let device = 'Unknown 📱';
  // Heuristic based on message ID length (not guaranteed, fun only)
  if (deviceId === 16) device = 'WhatsApp Web 🖥️';
  else if (deviceId === 20) device = 'Android 📱';
  else if (deviceId === 22) device = 'iPhone 🍎';
  else device = 'WhatsApp App 📱';

  await send(sock, from, msg,
    `📱 *Device Checker*\n\n` +
    `👤 *Number:* +${number}\n` +
    `📲 *Device:* ${device}\n\n` +
    `_Note: This is an approximation based on message data_`,
    '📱 Device Info');
}

// ── .movie ────────────────────────────────────────────────────────────────────
async function movie(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎬 Usage: .movie <title>\nExample: .movie Inception', '🎬 Movie Info');

  try {
    // Use free OMDB API (no key needed for basic results)
    const res = await axios.get('https://www.omdbapi.com/', {
      params: { t: text, apikey: 'trilogy', type: 'movie' },
      timeout: 15000
    });
    const d = res.data;
    if (d.Response === 'False') {
      return send(sock, from, msg, `❌ Movie not found: *${text}*\nTry a different title.`);
    }
    const content =
      `🎬 *${d.Title}* (${d.Year})\n\n` +
      `⭐ *Rating:* ${d.imdbRating}/10 (${d.imdbVotes} votes)\n` +
      `🎭 *Genre:* ${d.Genre}\n` +
      `⏱️ *Runtime:* ${d.Runtime}\n` +
      `🌍 *Language:* ${d.Language}\n` +
      `🏆 *Awards:* ${d.Awards}\n` +
      `🎥 *Director:* ${d.Director}\n` +
      `👥 *Cast:* ${d.Actors}\n\n` +
      `📖 *Plot:*\n${d.Plot}\n\n` +
      `🔗 *IMDB:* https://www.imdb.com/title/${d.imdbID}`;
    await send(sock, from, msg, content, `🎬 ${d.Title}`);
  } catch (e) {
    await send(sock, from, msg, `❌ Failed to fetch movie info: ${e.message}`);
  }
}

// ── .trailer ──────────────────────────────────────────────────────────────────
async function trailer(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎬 Usage: .trailer <movie title>\nExample: .trailer Avengers', '🎬 Movie Trailer');

  try {
    const query = encodeURIComponent(text + ' official trailer');
    const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
    const res = await axios.get(searchUrl, { timeout: 10000 });
    const match = res.data.match(/\/watch\?v=([\w-]{11})/);
    if (match) {
      const videoId = match[1];
      await send(sock, from, msg,
        `🎬 *Trailer: ${text}*\n\n` +
        `▶️ https://www.youtube.com/watch?v=${videoId}\n\n` +
        `_Open the link to watch the trailer_`,
        '🎬 Movie Trailer');
    } else {
      await send(sock, from, msg,
        `🔍 Search for the trailer here:\n${searchUrl}`,
        '🎬 Movie Trailer');
    }
  } catch (e) {
    await send(sock, from, msg, `❌ Couldn't fetch trailer: ${e.message}`);
  }
}

// ── .readsite ─────────────────────────────────────────────────────────────────
async function readsite(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🌐 Usage: .readsite <url>\nExample: .readsite https://example.com', '🌐 Read Site');

  let url = text.trim();
  if (!url.startsWith('http')) url = 'https://' + url;

  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    // Strip HTML tags and clean up whitespace
    const html = res.data;
    const text2 = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 800);
    await send(sock, from, msg,
      `🌐 *${url}*\n\n${text2}…\n\n_First 800 characters of content_`,
      '🌐 Site Reader');
  } catch (e) {
    await send(sock, from, msg, `❌ Failed to read site: ${e.message}`);
  }
}

// ── .goodmorning / .goodnight ─────────────────────────────────────────────────
const MORNING_MSGS = [
  "Rise and shine! ☀️ A new day full of possibilities awaits you!",
  "Good morning! 🌅 Today is a gift — make the most of it!",
  "Wake up and smell the coffee! ☕ Another beautiful day begins!",
  "Good morning! 🌞 May your day be as bright as your smile!",
  "Rise up, start fresh. 🌸 Good morning — you've got this!",
  "Good morning! 🐦 Early birds catch the worms AND the blessings!",
  "Morning! ✨ Believe in yourself — today is YOUR day!",
  "Good morning! 🌈 Forget yesterday's worries and embrace today!",
];

const NIGHT_MSGS = [
  "Good night! 🌙 Sweet dreams and peaceful rest to you.",
  "Sleep tight! ⭐ Tomorrow will be even better. Rest well!",
  "Good night! 🌛 May your dreams be full of wonderful adventures.",
  "Nighty night! 💤 Recharge for another amazing day tomorrow.",
  "Good night! 🌠 May you wake up refreshed and ready to conquer!",
  "Sweet dreams! 🌃 You've worked hard today. Rest now.",
  "Good night! 🌟 Sleep well — big things are coming your way!",
  "Time to rest! 🌜 Good night from your friendly bot 🤖",
];

async function goodmorning(ctx) {
  const { sock, from, msg, sender } = ctx;
  const greeting = MORNING_MSGS[Math.floor(Math.random() * MORNING_MSGS.length)];
  const hour = new Date().getHours();
  await send(sock, from, msg,
    `☀️ *Good Morning!*\n\n` +
    `👤 @${sender.split('@')[0]}\n\n` +
    `${greeting}\n\n` +
    `🕐 *Time:* ${new Date().toLocaleTimeString()}\n` +
    `📅 *Date:* ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n` +
    `_Have a wonderful day! 🌺_`,
    '☀️ Good Morning');
}

async function goodnight(ctx) {
  const { sock, from, msg, sender } = ctx;
  const greeting = NIGHT_MSGS[Math.floor(Math.random() * NIGHT_MSGS.length)];
  await send(sock, from, msg,
    `🌙 *Good Night!*\n\n` +
    `👤 @${sender.split('@')[0]}\n\n` +
    `${greeting}\n\n` +
    `🕐 *Time:* ${new Date().toLocaleTimeString()}\n` +
    `📅 *Date:* ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n` +
    `_Sleep well! 🌟_`,
    '🌙 Good Night');
}

// ── .channelstatus ────────────────────────────────────────────────────────────
async function channelstatus(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg,
    '📢 Usage: .channelstatus <channel invite link>\nExample: .channelstatus https://whatsapp.com/channel/xxx',
    '📢 Channel Status');

  const inviteCode = text.split('/').pop().trim();
  try {
    const info = await sock.getNewsletterInfo(inviteCode);
    const subs = info?.subscriberCount ?? '?';
    const name = info?.name ?? 'Unknown';
    const desc = info?.description ?? 'No description';
    const verified = info?.verification === 'VERIFIED' ? '✅ Verified' : '❌ Not Verified';
    await send(sock, from, msg,
      `📢 *Channel Info*\n\n` +
      `📌 *Name:* ${name}\n` +
      `${verified}\n` +
      `👥 *Subscribers:* ${subs}\n` +
      `📝 *Description:* ${desc}\n\n` +
      `🔗 *Link:* ${text}`,
      '📢 Channel Status');
  } catch {
    await send(sock, from, msg,
      `❌ *Could not fetch channel info*\n\nMake sure you sent a valid WhatsApp channel link.\n\n_Example: https://whatsapp.com/channel/..._`,
      '📢 Channel Status');
  }
}

// ── .hack ─────────────────────────────────────────────────────────────────────
async function hack(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  const target = text || `+${sender.split('@')[0]}`;
  const steps = [
    `[*] Initialising hack sequence for ${target}...`,
    `[*] Scanning ports... 22, 80, 443, 8080 ✓`,
    `[*] Bypassing firewall... ████████░░ 80%`,
    `[*] Firewall bypassed! ✓`,
    `[*] Injecting payload... ███████████ 100%`,
    `[*] Accessing database... ✓`,
    `[*] Extracting data... ████████████ 100%`,
    `[*] Covering tracks... ✓\n[*] Logs cleared.`,
    `\n✅ *HACK COMPLETE!*\n\n👤 Target: ${target}\n📁 Files stolen: ${Math.floor(Math.random()*9000+1000)}\n🔐 Passwords cracked: ${Math.floor(Math.random()*20+5)}\n💳 Cards found: ${Math.floor(Math.random()*5+1)}\n\n_😂 Relax! This is just for fun!_`,
  ];

  let sentMsg;
  for (let i = 0; i < steps.length; i++) {
    const content = steps.slice(0, i + 1).join('\n');
    if (!sentMsg) {
      sentMsg = await sendFireboxCard(sock, from, msg, {
        title: '💻 Hacking...',
        content,
      });
    } else {
      try {
        await sock.sendMessage(from, {
          text: `╔══════════════════════╗\n║  💻 *FIREBOX HACK*  ║\n╚══════════════════════╝\n\n${content}`,
          edit: sentMsg.key
        });
      } catch {
        sentMsg = await sock.sendMessage(from, {
          text: `╔══════════════════════╗\n║  💻 *FIREBOX HACK*  ║\n╚══════════════════════╝\n\n${content}`
        });
      }
    }
    await new Promise(r => setTimeout(r, 900));
  }
}

// ── .up (uptime) ─────────────────────────────────────────────────────────────
async function up(ctx) {
  const { sock, from, msg } = ctx;
  const s = Math.floor(process.uptime());
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const uptime = [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ');
  const mem = process.memoryUsage();
  await send(sock, from, msg,
    `✅ *Bot is Online!*\n\n` +
    `⏱️ *Uptime:* ${uptime}\n` +
    `💾 *RAM:* ${(mem.rss / 1024 / 1024).toFixed(1)} MB\n` +
    `⚡ *Status:* Running smoothly 🔥`,
    '⚡ Bot Status');
}

// ── .snake ────────────────────────────────────────────────────────────────────
// Simple single-turn text snake (not interactive — shows a snapshot board)
async function snake(ctx) {
  const { sock, from, msg } = ctx;
  // Generate a random snake board for fun
  const size = 8;
  const board = Array.from({ length: size }, () => Array(size).fill('⬛'));
  // Place snake
  const snakeLen = Math.floor(Math.random() * 4) + 3;
  const sx = Math.floor(Math.random() * (size - snakeLen));
  const sy = Math.floor(Math.random() * size);
  for (let i = 0; i < snakeLen; i++) board[sy][sx + i] = i === snakeLen - 1 ? '🟩' : '🟢';
  // Place food
  let fx, fy;
  do { fx = Math.floor(Math.random() * size); fy = Math.floor(Math.random() * size); }
  while (board[fy][fx] !== '⬛');
  board[fy][fx] = '🍎';
  const score = Math.floor(Math.random() * 50) + snakeLen * 10;
  const grid = board.map(r => r.join('')).join('\n');
  await send(sock, from, msg,
    `${grid}\n\n` +
    `🟩 Head  🟢 Body  🍎 Food\n` +
    `📊 *Score:* ${score}\n` +
    `📏 *Length:* ${snakeLen}\n\n` +
    `_Interactive snake coming soon!_`,
    '🐍 Snake Game');
}

// ── .tictactoe ────────────────────────────────────────────────────────────────
async function tictactoe(ctx) {
  const { sock, from, msg, text } = ctx;
  // Simple: show a board or make a move
  // Display a fresh game board
  const cells = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
  const board =
    `${cells[0]} ${cells[1]} ${cells[2]}\n` +
    `${cells[3]} ${cells[4]} ${cells[5]}\n` +
    `${cells[6]} ${cells[7]} ${cells[8]}`;
  await send(sock, from, msg,
    `*Tic Tac Toe*\n\n` +
    `${board}\n\n` +
    `*How to play:*\n` +
    `• Two players take turns\n` +
    `• ❌ vs ⭕\n` +
    `• Get 3 in a row to win!\n\n` +
    `_Reply with a number (1-9) to make a move_\n` +
    `_Interactive mode coming soon!_`,
    '🎮 Tic Tac Toe');
}

module.exports = { bf, gf, couple, gay, getjid, device, movie, trailer, readsite, goodmorning, goodnight, channelstatus, hack, up, snake, tictactoe };
