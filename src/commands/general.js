const os = require('os');
const { performance } = require('perf_hooks');
const db = require('../database');
const f = require('../fonts');
const { generateMenuImage } = require('../menuImage');

function getUptime() {
  const s = Math.floor(process.uptime());
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

async function ping(ctx) {
  const { sock, from, msg } = ctx;
  const start = performance.now();
  await sock.sendMessage(from, { text: `🏓 ${f.italic('Pinging...')}` }, { quoted: msg });
  const ms = (performance.now() - start).toFixed(2);
  await sock.sendMessage(from, {
    text: `🏓 ${f.bold('Pong!')}\n⚡ ${f.smallCaps('Speed')}: ${f.mono(ms + 'ms')}`
  }, { quoted: msg });
}

async function info(ctx) {
  const { sock, from, msg, sessionState } = ctx;
  const mem = process.memoryUsage();
  const text = `╔══════════════════════╗
║  🤖  ${f.bold('BOT  INFO')}  🤖  ║
╚══════════════════════╝

🔥 ${f.smallCaps('Name')}     » ${f.boldItalic('Firebox')}
🏷️ ${f.smallCaps('Version')}  » ${f.mono('v2.0.0')}
⏱️ ${f.smallCaps('Uptime')}   » ${f.italic(getUptime())}
💾 ${f.smallCaps('RAM')}      » ${f.mono((mem.rss / 1024 / 1024).toFixed(1) + ' MB')}
🖥️ ${f.smallCaps('Platform')} » ${f.italic(os.platform() + ' (' + os.arch() + ')')}
📦 ${f.smallCaps('Node.js')}  » ${f.mono(process.version)}
🧠 ${f.smallCaps('AI')}       » ${f.italic('Google Gemini 2.0 Flash')}
📊 ${f.smallCaps('Messages')} » ${f.bold(String(sessionState.messageCount))}
⚡ ${f.smallCaps('Commands')} » ${f.bold(String(sessionState.commandCount))}

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
${f.italic('Built with ❤️ by Firebox')}`;
  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function owner(ctx) {
  const { sock, from, msg } = ctx;
  const ownerNumber = process.env.OWNER_NUMBER || 'Not configured';
  const ownerName = process.env.OWNER_NAME || 'Owner';
  const text = `╔══════════════════════╗
║  👑  ${f.bold('BOT  OWNER')}  👑  ║
╚══════════════════════╝

👤 ${f.smallCaps('Name')}   » ${f.boldItalic(ownerName)}
📱 ${f.smallCaps('Number')} » ${f.mono('+' + ownerNumber)}
🤖 ${f.smallCaps('Bot')}    » ${f.italic('Firebox v2.0.0')}
🌐 ${f.smallCaps('Status')} » ${f.bold('Online')} ✅

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
${f.italic('Contact owner for support')}`;
  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function runtime(ctx) {
  const { sock, from, msg } = ctx;
  await sock.sendMessage(from, {
    text: `⏱️ ${f.bold('Bot Runtime')}\n\n🔥 ${f.italic('Firebox')} has been running for:\n${f.mono(getUptime())}`
  }, { quoted: msg });
}

async function menu(ctx) {
  const { sock, from, msg, prefix, sender, sessionState } = ctx;
  const p = prefix || process.env.PREFIX || '.';
  const botMode = db.getBotSetting('botMode') || 'public';

  const row = (title, desc, id) => ({ title, description: desc, rowId: id });

  const sections = [
    {
      title: '🔵 General',
      rows: [
        row(`${p}ping`,      'Check bot response speed',           `${p}ping`),
        row(`${p}info`,      'Bot info, uptime & stats',           `${p}info`),
        row(`${p}owner`,     'Show bot owner contact',             `${p}owner`),
        row(`${p}runtime`,   'How long bot has been running',      `${p}runtime`),
        row(`${p}botstatus`, 'Detailed bot status report',         `${p}botstatus`),
        row(`${p}pair`,      'Get a pairing code for this bot',    `${p}pair`),
        row(`${p}repo`,      'Bot source code / repo link',        `${p}repo`),
        row(`${p}help`,      'Detailed help for any command',      `${p}help`),
      ]
    },
    {
      title: '🤖 AI Chat',
      rows: [
        row(`${p}ai`,        'Ask Gemini AI anything',             `${p}ai`),
        row(`${p}analyze`,   'Analyze text or image with AI',      `${p}analyze`),
        row(`${p}code`,      'AI coding assistant',                `${p}code`),
        row(`${p}blackbox`,  'Expert AI code solutions',           `${p}blackbox`),
        row(`${p}deepseek`,  'DeepSeek AI reasoning',              `${p}deepseek`),
        row(`${p}translate`, 'Translate text to any language',     `${p}translate`),
        row(`${p}story`,     'Generate a short story',             `${p}story`),
        row(`${p}summarize`, 'Summarize long text',                `${p}summarize`),
        row(`${p}recipe`,    'Get a recipe for any dish',          `${p}recipe`),
        row(`${p}teach`,     'Explain any topic simply',           `${p}teach`),
        row(`${p}simi`,      'Chat with Simi AI',                  `${p}simi`),
        row(`${p}doppleai`,  'AI roleplay / character chat',       `${p}doppleai`),
      ]
    },
    {
      title: '🎨 AI Image',
      rows: [
        row(`${p}dalle`,    'Generate image with DALL·E',          `${p}dalle`),
        row(`${p}generate`, 'Text-to-image AI art',                `${p}generate`),
      ]
    },
    {
      title: '🎵 Download',
      rows: [
        row(`${p}play`,        'Download YouTube song as MP3',     `${p}play`),
        row(`${p}video`,       'Download YouTube video (≤10 min)', `${p}video`),
        row(`${p}song`,        'Search & download any song',       `${p}song`),
        row(`${p}tiktok`,      'Download TikTok video',            `${p}tiktok`),
        row(`${p}tiktokaudio`, 'Download TikTok audio only',       `${p}tiktokaudio`),
        row(`${p}instagram`,   'Download Instagram photo/video',   `${p}instagram`),
        row(`${p}facebook`,    'Download Facebook video',          `${p}facebook`),
        row(`${p}twitter`,     'Download Twitter/X video',         `${p}twitter`),
        row(`${p}pinterest`,   'Download Pinterest image/video',   `${p}pinterest`),
        row(`${p}savestatus`,  'Save someone\'s WhatsApp status',  `${p}savestatus`),
        row(`${p}image`,       'Search & download an image',       `${p}image`),
        row(`${p}wallpaper`,   'Download HD wallpaper',            `${p}wallpaper`),
        row(`${p}apk`,         'Download APK from APKPure',        `${p}apk`),
        row(`${p}mediafire`,   'Download from MediaFire link',     `${p}mediafire`),
        row(`${p}gitclone`,    'Download a GitHub repository',     `${p}gitclone`),
      ]
    },
    {
      title: '🔍 Search',
      rows: [
        row(`${p}lyrics`,   'Get song lyrics',                    `${p}lyrics`),
        row(`${p}songinfo`, 'Song details & info',                `${p}songinfo`),
        row(`${p}shazam`,   'Identify a song from audio',         `${p}shazam`),
        row(`${p}weather`,  'Check weather for a city',           `${p}weather`),
        row(`${p}define`,   'Define a word',                      `${p}define`),
        row(`${p}imdb`,     'Movie/show info from IMDb',          `${p}imdb`),
        row(`${p}yts`,      'Search YouTube videos',              `${p}yts`),
      ]
    },
    {
      title: '🛠️ Tools',
      rows: [
        row(`${p}sticker`,   'Convert image/video to sticker',   `${p}sticker`),
        row(`${p}toimg`,     'Convert sticker back to image',    `${p}toimg`),
        row(`${p}vv`,        'Reveal view-once photo/video',     `${p}vv`),
        row(`${p}read`,      'Read text from image (OCR)',        `${p}read`),
        row(`${p}tts`,       'Text to speech voice note',        `${p}tts`),
        row(`${p}fancy`,     'Convert text to fancy fonts',      `${p}fancy`),
        row(`${p}qrcode`,    'Generate a QR code',               `${p}qrcode`),
        row(`${p}tinyurl`,   'Shorten a long URL',               `${p}tinyurl`),
        row(`${p}calculate`, 'Math calculator',                  `${p}calculate`),
        row(`${p}genpass`,   'Generate a strong password',       `${p}genpass`),
        row(`${p}getpp`,     'Get someone\'s profile photo',     `${p}getpp`),
        row(`${p}emojimix`,  'Mix two emojis together',          `${p}emojimix`),
      ]
    },
    {
      title: '✨ Fun & Extras',
      rows: [
        row(`${p}time`,      'Current time for any city',        `${p}time`),
        row(`${p}anon`,      'Send anonymous message',           `${p}anon`),
        row(`${p}confess`,   'Send anonymous confession',        `${p}confess`),
        row(`${p}compliment`,'Get a compliment',                 `${p}compliment`),
        row(`${p}roast`,     'Get roasted 🔥',                   `${p}roast`),
        row(`${p}wyr`,       'Would You Rather question',        `${p}wyr`),
        row(`${p}riddle`,    'Answer a riddle',                  `${p}riddle`),
        row(`${p}reverse`,   'Reverse any text',                 `${p}reverse`),
        row(`${p}morse`,     'Convert text to morse code',       `${p}morse`),
        row(`${p}binary`,    'Convert text to binary',           `${p}binary`),
        row(`${p}wordcount`, 'Count words in text',              `${p}wordcount`),
        row(`${p}age`,       'Calculate age from birthdate',     `${p}age`),
        row(`${p}countdown`, 'Countdown to a date',              `${p}countdown`),
        row(`${p}repeat`,    'Repeat a message N times',         `${p}repeat`),
        row(`${p}guess`,     'Number guessing game',             `${p}guess`),
      ]
    },
    {
      title: '🎵 Audio Effects',
      rows: [
        row(`${p}bass`,         'Bass boost audio',              `${p}bass`),
        row(`${p}blown`,        'Blown speaker effect',          `${p}blown`),
        row(`${p}deep`,         'Deep/slow voice effect',        `${p}deep`),
        row(`${p}earrape`,      'Earrape audio effect',          `${p}earrape`),
        row(`${p}robot`,        'Robot voice effect',            `${p}robot`),
        row(`${p}reverseaudio`, 'Reverse audio',                 `${p}reverseaudio`),
        row(`${p}tomp3`,        'Convert audio/video to MP3',    `${p}tomp3`),
        row(`${p}toptt`,        'Convert audio to voice note',   `${p}toptt`),
        row(`${p}volaudio`,     'Adjust audio volume',           `${p}volaudio`),
      ]
    },
    {
      title: '🖼️ Image Effects',
      rows: [
        row(`${p}blur`,       'Blur an image',                   `${p}blur`),
        row(`${p}cartoon`,    'Cartoonify an image',             `${p}cartoon`),
        row(`${p}anime`,      'Anime-style filter',              `${p}anime`),
        row(`${p}sketch`,     'Pencil sketch effect',            `${p}sketch`),
        row(`${p}neon`,       'Neon glow effect',                `${p}neon`),
        row(`${p}glitch`,     'Glitch effect',                   `${p}glitch`),
        row(`${p}wasted`,     'GTA Wasted overlay',              `${p}wasted`),
        row(`${p}wanted`,     'Wanted poster effect',            `${p}wanted`),
        row(`${p}sepia`,      'Sepia tone filter',               `${p}sepia`),
        row(`${p}invert`,     'Invert image colors',             `${p}invert`),
      ]
    },
    {
      title: '🖼️ More Effects',
      rows: [
        row(`${p}greyscale`,  'Black & white filter',            `${p}greyscale`),
        row(`${p}pixelate`,   'Pixelate image',                  `${p}pixelate`),
        row(`${p}watercolor`, 'Watercolor painting effect',      `${p}watercolor`),
        row(`${p}oil`,        'Oil painting effect',             `${p}oil`),
        row(`${p}fire`,       'Fire frame effect',               `${p}fire`),
        row(`${p}snow`,       'Snow effect',                     `${p}snow`),
        row(`${p}rainbow`,    'Rainbow overlay',                 `${p}rainbow`),
        row(`${p}vintage`,    'Vintage/retro filter',            `${p}vintage`),
        row(`${p}mirror`,     'Mirror/flip image',               `${p}mirror`),
        row(`${p}comicbook`,  'Comic book effect',               `${p}comicbook`),
      ]
    },
    {
      title: '⛪ Religion',
      rows: [
        row(`${p}bible`,  'Get a Bible verse',                   `${p}bible`),
        row(`${p}quran`,  'Get a Quran surah/ayah',              `${p}quran`),
      ]
    },
    {
      title: '👥 Group',
      rows: [
        row(`${p}tagall`,      'Tag all group members',          `${p}tagall`),
        row(`${p}hidetag`,     'Tag all without showing names',  `${p}hidetag`),
        row(`${p}tagadmin`,    'Tag all admins',                 `${p}tagadmin`),
        row(`${p}kick`,        'Kick a member',                  `${p}kick`),
        row(`${p}add`,         'Add someone to the group',       `${p}add`),
        row(`${p}promote`,     'Promote member to admin',        `${p}promote`),
        row(`${p}demote`,      'Remove admin rights',            `${p}demote`),
        row(`${p}mute`,        'Mute the group (admins only)',   `${p}mute`),
        row(`${p}unmute`,      'Unmute the group',               `${p}unmute`),
        row(`${p}poll`,        'Create a group poll',            `${p}poll`),
      ]
    },
    {
      title: '🛡️ Group Protection',
      rows: [
        row(`${p}warn`,        'Warn a member',                  `${p}warn`),
        row(`${p}antilink`,    'Toggle anti-link protection',    `${p}antilink`),
        row(`${p}antiban`,     'Prevent mass-kick attacks',      `${p}antiban`),
        row(`${p}anticall`,    'Block calls in group',           `${p}anticall`),
        row(`${p}antibadword`, 'Auto-delete bad words',          `${p}antibadword`),
        row(`${p}antibot`,     'Prevent bots joining',           `${p}antibot`),
        row(`${p}antidemote`,  'Prevent unauthorized demotes',   `${p}antidemote`),
        row(`${p}setwelcome`,  'Set welcome message',            `${p}setwelcome`),
        row(`${p}groupinfo`,   'Show group info & stats',        `${p}groupinfo`),
        row(`${p}link`,        'Get group invite link',          `${p}link`),
      ]
    },
    {
      title: '🎮 Games',
      rows: [
        row(`${p}8ball`,         'Ask the magic 8 ball',         `${p}8ball`),
        row(`${p}truth`,         'Truth question',               `${p}truth`),
        row(`${p}dare`,          'Dare challenge',               `${p}dare`),
        row(`${p}trivia`,        'Trivia question',              `${p}trivia`),
        row(`${p}joke`,          'Tell a joke',                  `${p}joke`),
        row(`${p}fact`,          'Random interesting fact',      `${p}fact`),
        row(`${p}quote`,         'Random inspirational quote',   `${p}quote`),
        row(`${p}memes`,         'Random meme',                  `${p}memes`),
        row(`${p}dice`,          'Roll a dice',                  `${p}dice`),
        row(`${p}coinflip`,      'Flip a coin',                  `${p}coinflip`),
        row(`${p}rps`,           'Rock Paper Scissors',          `${p}rps`),
        row(`${p}truthdetector`, 'Truth detector game',          `${p}truthdetector`),
        row(`${p}xxqc`,          'Quick question challenge',     `${p}xxqc`),
      ]
    },
    {
      title: '💻 Hacking',
      rows: [
        row(`${p}iplookup`,  'Look up an IP address',            `${p}iplookup`),
        row(`${p}whois`,     'WHOIS domain lookup',              `${p}whois`),
        row(`${p}dns`,       'DNS record lookup',                `${p}dns`),
        row(`${p}hash`,      'Hash text (MD5/SHA)',               `${p}hash`),
        row(`${p}checkpass`, 'Check password strength',          `${p}checkpass`),
        row(`${p}b64encode`, 'Base64 encode text',               `${p}b64encode`),
        row(`${p}b64decode`, 'Base64 decode text',               `${p}b64decode`),
        row(`${p}cipher`,    'Encrypt/decrypt text',             `${p}cipher`),
        row(`${p}sslcheck`,  'Check SSL certificate',            `${p}sslcheck`),
        row(`${p}numlookup`, 'Phone number lookup',              `${p}numlookup`),
        row(`${p}scamalyze`, 'Detect scam messages',             `${p}scamalyze`),
        row(`${p}hack`,      'Hacking simulation',               `${p}hack`),
      ]
    },
    {
      title: '👑 Owner',
      rows: [
        row(`${p}dead`,       'Toggle bot dead/offline mode',    `${p}dead`),
        row(`${p}mode`,       'Set bot mode (public/private)',   `${p}mode`),
        row(`${p}aichat`,     'Toggle AI chatbot mode',          `${p}aichat`),
        row(`${p}autoreply`,  'Set auto-reply message',          `${p}autoreply`),
        row(`${p}broadcast`,  'Send message to contact list',    `${p}broadcast`),
        row(`${p}schedule`,   'Schedule a message',              `${p}schedule`),
        row(`${p}tostatus`,   'Post image/video as status',      `${p}tostatus`),
        row(`${p}away`,       'Toggle away/busy mode',           `${p}away`),
        row(`${p}block`,      'Block a user',                    `${p}block`),
        row(`${p}unblock`,    'Unblock a user',                  `${p}unblock`),
        row(`${p}delete`,     'Delete a message',                `${p}delete`),
        row(`${p}restart`,    'Restart the bot',                 `${p}restart`),
        row(`${p}forward`,    'Forward a message',               `${p}forward`),
        row(`${p}setprefix`,  'Change command prefix',           `${p}setprefix`),
        row(`${p}disk`,       'Check server disk usage',         `${p}disk`),
        row(`${p}update`,     'Update yt-dlp & deps',            `${p}update`),
      ]
    },
    {
      title: '⚙️ Owner Auto',
      rows: [
        row(`${p}autoviewstatus`,  'Auto-view all statuses',     `${p}autoviewstatus`),
        row(`${p}autoreactstatus`, 'Auto-react to statuses',     `${p}autoreactstatus`),
        row(`${p}autostatusreply`, 'AI smart status replies',    `${p}autostatusreply`),
        row(`${p}autosavestatus`,  'Auto-save statuses',         `${p}autosavestatus`),
        row(`${p}antideletestatus`,'Alert on deleted statuses',  `${p}antideletestatus`),
        row(`${p}alwaysonline`,    'Always appear online',       `${p}alwaysonline`),
        row(`${p}autoread`,        'Auto-read all messages',     `${p}autoread`),
        row(`${p}autoreact`,       'Auto-react to messages',     `${p}autoreact`),
        row(`${p}autorecord`,      'Appear always recording',    `${p}autorecord`),
        row(`${p}autotype`,        'Appear always typing',       `${p}autotype`),
        row(`${p}autobio`,         'Auto-update bio',            `${p}autobio`),
        row(`${p}chatbot`,         'Toggle chatbot mode',        `${p}chatbot`),
        row(`${p}antidelete`,      'Alert on deleted messages',  `${p}antidelete`),
        row(`${p}antiedit`,        'Alert on edited messages',   `${p}antiedit`),
        row(`${p}antiviewonce`,    'Auto-reveal view-once',      `${p}antiviewonce`),
        row(`${p}anticalldm`,      'Block DM calls to the bot',  `${p}anticalldm`),
      ]
    },
    {
      title: '🔧 Owner Settings',
      rows: [
        row(`${p}setbotname`,         'Change bot name',         `${p}setbotname`),
        row(`${p}setownername`,       'Change owner name',       `${p}setownername`),
        row(`${p}settimezone`,        'Set bot timezone',        `${p}settimezone`),
        row(`${p}setstickerauthor`,   'Set sticker author name', `${p}setstickerauthor`),
        row(`${p}setstickerpackname`, 'Set sticker pack name',   `${p}setstickerpackname`),
        row(`${p}setwatermark`,       'Set image watermark',     `${p}setwatermark`),
        row(`${p}setmenu`,            'Set custom menu text',    `${p}setmenu`),
        row(`${p}setmenuimage`,       'Set menu image',          `${p}setmenuimage`),
        row(`${p}setfont`,            'Set bot font style',      `${p}setfont`),
        row(`${p}getsettings`,        'View all bot settings',   `${p}getsettings`),
        row(`${p}resetsetting`,       'Reset a bot setting',     `${p}resetsetting`),
        row(`${p}addsudo`,            'Add a sudo/admin user',   `${p}addsudo`),
        row(`${p}delsudo`,            'Remove a sudo user',      `${p}delsudo`),
        row(`${p}listsudo`,           'List all sudo users',     `${p}listsudo`),
        row(`${p}setwarn`,            'Set max warnings',        `${p}setwarn`),
      ]
    },
  ];

  const body = sections.map(s => {
    const icon  = s.title.split(' ')[0];
    const title = s.title.replace(/^\S+\s*/, '');
    const cmds  = s.rows.map(r => `  ┃ ${r.title}`).join('\n');
    return `┏━━━ ${icon} ${f.bold(title)}\n${cmds}\n┗━━━━━━━━━━━`;
  }).join('\n\n');

  const header =
    `╔══════════════════════╗\n` +
    `║  🔥  ${f.bold('FIREBOX  BOT')}  🔥  ║\n` +
    `╚══════════════════════╝\n\n` +
    `📌 ${f.smallCaps('Prefix')} » ${f.mono(p)}   ⏱️ ${f.smallCaps('Uptime')} » ${f.italic(getUptime())}\n` +
    `🌐 ${f.smallCaps('Mode')}   » ${f.bold(botMode.toUpperCase())}\n` +
    `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n`;

  const footer =
    `\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
    `${f.italic('Type')} ${f.mono(p + 'help <cmd>')} ${f.italic('for details on any command')}`;

  // Send menu image with full command list as caption
  try {
    const botName = db.getBotSetting('botName') || 'FIREBOX';
    const userNum  = sender ? sender.split('@')[0] : '';
    const imgBuf   = await generateMenuImage(botName, p, userNum);
    const caption  = header + body + footer;
    await sock.sendMessage(from, { image: imgBuf, caption }, { quoted: msg });
  } catch (err) {
    // Fallback to text if image fails
    console.error('[MENU] Image generation failed:', err.message);
    await sock.sendMessage(from, { text: header + body + footer }, { quoted: msg });
  }

}

async function sendButtons(sock, from, msg, text, buttons, sender, prefix, sessionState) {
  const lines = buttons.map((b, i) => `  *${i + 1}.* ${b.label}`).join('\n');
  await sock.sendMessage(from, {
    text: `${text}\n\n${lines}`
  }, { quoted: msg });
  sessionState.pendingPrompts.set(sender, {
    type: 'cmd',
    cmdPrefix: prefix,
    prompts: buttons.map(b => b.id.startsWith(prefix) ? b.id.slice(prefix.length) : b.id),
    expiresAt: Date.now() + 5 * 60 * 1000
  });
}

const HELP = {
  // General
  info:     { usage: 'info', desc: 'Show bot info, uptime, memory and stats.' },
  owner:    { usage: 'owner', desc: 'Show the bot owner contact.' },
  ping:     { usage: 'ping', desc: 'Check bot speed and response time.' },
  runtime:  { usage: 'runtime', desc: 'Show how long the bot has been running.' },
  menu:     { usage: 'menu', desc: 'List all available commands.' },

  // AI
  ai:       { usage: 'ai <question>', desc: 'Ask Gemini AI anything.' },
  analyze:  { usage: 'analyze <text>', desc: 'Analyze a piece of text with AI.' },
  blackbox: { usage: 'blackbox <problem>', desc: 'Get expert AI-powered code solutions.' },
  code:     { usage: 'code <problem>', desc: 'Coding assistant — explain or write code.' },
  recipe:   { usage: 'recipe <dish>', desc: 'Get a full recipe for any dish.' },
  simi:     { usage: 'simi <message>', desc: 'Chat casually with Simi AI.' },
  story:    { usage: 'story <topic>', desc: 'Write a short story on any topic.' },
  summarize:{ usage: 'summarize <text>', desc: 'Summarize a long piece of text.' },
  teach:    { usage: 'teach <topic>', desc: 'Learn about any topic in simple terms.' },
  translate:{ usage: 'translate <lang> <text>', desc: 'Translate text to a target language. e.g. .translate french Hello' },

  // Stickers
  sticker:  { usage: 'sticker', desc: 'Reply to an image or video to turn it into a sticker.' },
  toimg:    { usage: 'toimg', desc: 'Reply to a sticker to convert it back to an image.' },

  // Download
  facebook: { usage: 'facebook <url>', desc: 'Download a Facebook video.' },
  instagram:{ usage: 'instagram <url>', desc: 'Download an Instagram photo or video.' },
  pin:      { usage: 'pin <url>', desc: 'Download a Pinterest image or video.' },
  play:     { usage: 'play <name>', desc: 'Search and download a YouTube video as MP3.' },
  savestatus:{ usage: 'savestatus', desc: 'Reply to a status to save it.' },
  song:     { usage: 'song <name>', desc: 'Download a song by name.' },
  tiktok:   { usage: 'tiktok <url>', desc: 'Download a TikTok video without watermark.' },
  tiktokaudio:{ usage: 'tiktokaudio <url>', desc: 'Download only the audio from a TikTok.' },
  twitter:  { usage: 'twitter <url>', desc: 'Download a Twitter/X video.' },
  video:    { usage: 'video <name>', desc: 'Search and download a YouTube video as MP4.' },

  // Search
  define:   { usage: 'define <word>', desc: 'Look up the dictionary definition of a word.' },
  imdb:     { usage: 'imdb <title>', desc: 'Get movie or TV show info from IMDB.' },
  lyrics:   { usage: 'lyrics <song>', desc: 'Fetch lyrics for a song.' },
  songinfo: { usage: 'songinfo <song>', desc: 'Get song details — artist, album, genre, year, duration and cover art.' },
  weather:  { usage: 'weather <city>', desc: 'Get live weather info for a city.' },
  yts:      { usage: 'yts <query>', desc: 'Search YouTube and get results.' },

  // Tools
  age:          { usage: 'age <DD/MM/YYYY>', desc: 'Calculate age from a birthdate. e.g. .age 15/08/1998' },
  reverse:      { usage: 'reverse <text>', desc: 'Reverse any text. e.g. .reverse Hello' },
  wordcount:    { usage: 'wordcount <text>', desc: 'Count words, characters, and sentences in text.' },
  morse:        { usage: 'morse encode/decode <text>', desc: 'Encode or decode Morse code. e.g. .morse encode hello' },
  binary:       { usage: 'binary encode/decode <text>', desc: 'Encode text to binary or decode binary to text.' },
  repeat:       { usage: 'repeat <1-20> <text>', desc: 'Repeat text multiple times. e.g. .repeat 3 Hello!' },
  countdown:    { usage: 'countdown <DD/MM/YYYY>', desc: 'Countdown to a future date. e.g. .countdown 31/12/2025' },
  rps:          { usage: 'rps <rock/paper/scissors>', desc: 'Play Rock Paper Scissors against the bot.' },
  compliment:   { usage: 'compliment', desc: 'Get a random compliment.' },
  roast:        { usage: 'roast', desc: 'Get a random (harmless) roast.' },
  wyr:          { usage: 'wyr', desc: 'Get a random "Would You Rather?" question.' },
  riddle:       { usage: 'riddle', desc: 'Get a random riddle with a hidden answer.' },
  guess:        { usage: 'guess <number> or guess start', desc: 'Guess the number game (1-100, 7 attempts). Start with .guess start' },
  anon:         { usage: 'anon <number> <message>', desc: 'Send an anonymous message to a number.' },
  calculate:    { usage: 'calculate <expression>', desc: 'Evaluate a math expression. e.g. .calculate 2+2*5' },
  cancelschedule:{ usage: 'cancelschedule <id>', desc: 'Cancel a scheduled message by its ID.' },
  confess:      { usage: 'confess <message>', desc: 'Submit an anonymous confession.' },
  delete:       { usage: 'delete', desc: 'Reply to a message to delete it (bot must be admin in groups).' },
  emojimix:     { usage: 'emojimix <emoji1> <emoji2>', desc: 'Mix two emojis together. e.g. .emojimix 😀 😎' },
  fancy:        { usage: 'fancy <text>', desc: 'Convert text into fancy Unicode fonts.' },
  forward:      { usage: 'forward <number>', desc: 'Reply to a message to forward it to a number.' },
  genpass:      { usage: 'genpass [length]', desc: 'Generate a secure random password. Default length: 16.' },
  getpp:        { usage: 'getpp @user', desc: 'Get the profile picture of a user.' },
  qrcode:       { usage: 'qrcode <text>', desc: 'Generate a QR code from any text or URL.' },
  react:        { usage: 'react <emoji>', desc: 'React to a replied message with an emoji.' },
  schedule:     { usage: 'schedule <delay> <message>', desc: 'Schedule a message. e.g. .schedule 10m Good morning' },
  schedulelist: { usage: 'schedulelist', desc: 'View all your currently scheduled messages.' },
  time:         { usage: 'time [timezone]', desc: 'Get the current time. e.g. .time Africa/Nairobi' },
  tinyurl:      { usage: 'tinyurl <url>', desc: 'Shorten a long URL.' },
  tts:          { usage: 'tts [lang] <text>', desc: 'Convert text to a voice note. e.g. .tts Hello! or .tts sw Habari yako' },
  vv:           { usage: 'vv', desc: 'Reply to a view-once message to reveal it.' },

  // Owner
  antidelete:       { usage: 'antidelete on/off', desc: 'Catch and forward deleted messages to your DM.' },
  antideletestatus: { usage: 'antideletestatus on/off', desc: 'Catch deleted statuses and send them to your DM.' },
  antiedit:         { usage: 'antiedit on/off', desc: 'Catch and log edited messages.' },
  autoviewstatus:   { usage: 'autoviewstatus on/off', desc: 'Automatically view all contacts\' statuses.' },
  away:             { usage: 'away on/off [custom message]', desc: 'Enable/disable away mode — auto-notifies DM senders you\'re offline. e.g. .away on I\'m busy, back later!' },
  block:            { usage: 'block @user', desc: 'Block a user from contacting the bot.' },
  broadcaststatus:  { usage: 'broadcaststatus <message>', desc: 'Post a text as a WhatsApp status.' },
  clearcf:          { usage: 'clearcf <id>', desc: 'Delete a confession by its ID.' },
  inbox:            { usage: 'inbox', desc: 'View all anonymous confessions sent to the bot.' },
  join:             { usage: 'join <invite link>', desc: 'Make the bot join a group via invite link.' },
  leave:            { usage: 'leave', desc: 'Make the bot leave the current group.' },
  restart:          { usage: 'restart', desc: 'Restart the bot (owner only).' },
  setbio:           { usage: 'setbio <text>', desc: 'Update the bot\'s WhatsApp bio/about.' },
  setprefix:        { usage: 'setprefix <symbol>', desc: 'Change the bot command prefix. e.g. .setprefix !' },
  sharecf:          { usage: 'sharecf <id>', desc: 'Share a confession anonymously in the current chat.' },
  tostatus:         { usage: 'tostatus [caption]', desc: 'Reply to media to post it as a WhatsApp status.' },
  unblock:          { usage: 'unblock @user', desc: 'Unblock a previously blocked user.' },

  // Group
  add:          { usage: 'add <number>', desc: 'Add a member to the group.' },
  addbc:        { usage: 'addbc <number>', desc: 'Add a number to the broadcast list.' },
  addword:      { usage: 'addword <word>', desc: 'Add a banned word to the group filter.' },
  antiban:      { usage: 'antiban on/off', desc: 'Enable anti-ban mode (adds delays between messages).' },
  antibadword:  { usage: 'antibadword on/off', desc: 'Auto-kick members who use banned words.' },
  anticall:     { usage: 'anticall on/off', desc: 'Block incoming calls to the bot.' },
  antilink:     { usage: 'antilink on/off', desc: 'Auto-delete messages containing group invite links.' },
  broadcast:    { usage: 'broadcast <message>', desc: 'Send a message to all numbers on the broadcast list.' },
  clearbc:      { usage: 'clearbc', desc: 'Clear the entire broadcast list.' },
  demote:       { usage: 'demote @user', desc: 'Remove admin rights from a group member.' },
  groupinfo:    { usage: 'groupinfo', desc: 'View current group settings and toggles.' },
  hidetag:      { usage: 'hidetag [message]', desc: 'Silently tag all group members.' },
  kick:         { usage: 'kick @user', desc: 'Remove a member from the group.' },
  kickall:      { usage: 'kickall', desc: 'Kick all non-admin members from the group.' },
  link:         { usage: 'link', desc: 'Get the group invite link.' },
  listbc:       { usage: 'listbc', desc: 'View all numbers in the broadcast list.' },
  listwarn:     { usage: 'listwarn', desc: 'List all warned members in the group.' },
  listwords:    { usage: 'listwords', desc: 'Show all banned words in the group.' },
  mute:         { usage: 'mute', desc: 'Lock the group so only admins can send messages.' },
  unmute:       { usage: 'unmute', desc: 'Open the group for all members to send messages.' },
  poll:         { usage: 'poll Q|A|B|C', desc: 'Create a poll. e.g. .poll Favourite color?|Red|Blue|Green' },
  promote:      { usage: 'promote @user', desc: 'Make a group member an admin.' },
  removebc:     { usage: 'removebc <number>', desc: 'Remove a number from the broadcast list.' },
  removeword:   { usage: 'removeword <word>', desc: 'Remove a word from the banned words list.' },
  resetlink:    { usage: 'resetlink', desc: 'Reset and revoke the group invite link.' },
  resetwarn:    { usage: 'resetwarn @user', desc: 'Reset all warnings for a member.' },
  setdesc:      { usage: 'setdesc <text>', desc: 'Set the group description.' },
  setgoodbye:   { usage: 'setgoodbye <message>', desc: 'Set a custom goodbye message for members who leave.' },
  setgroupname: { usage: 'setgroupname <name>', desc: 'Rename the group.' },
  setwelcome:   { usage: 'setwelcome <message>', desc: 'Set a custom welcome message for new members.' },
  tagadmin:     { usage: 'tagadmin [message]', desc: 'Tag all group admins.' },
  tagall:       { usage: 'tagall [message]', desc: 'Tag every member in the group.' },
  totalmembers: { usage: 'totalmembers', desc: 'Show the total member count in the group.' },
  warn:         { usage: 'warn @user', desc: 'Warn a member. Auto-kick at 3 warnings.' },
  welcome:      { usage: 'welcome on/off', desc: 'Toggle the welcome message for new members.' },

  // Hacking
  b64decode:  { usage: 'b64decode <text>', desc: 'Decode a Base64-encoded string.' },
  b64encode:  { usage: 'b64encode <text>', desc: 'Encode text into Base64.' },
  checkpass:  { usage: 'checkpass <password>', desc: 'Check the strength of a password.' },
  cipher:     { usage: 'cipher encode/decode <n> <text>', desc: 'Apply Caesar cipher. e.g. .cipher encode 3 hello' },
  dns:        { usage: 'dns <domain>', desc: 'Perform a DNS lookup on a domain.' },
  fakecall:   { usage: 'fakecall <name>', desc: 'Simulate a fake incoming WhatsApp call animation. e.g. .fakecall Mum' },
  hack:       { usage: 'hack <phone number>', desc: 'Fake-hack a phone number for fun. e.g. .hack +254712345678' },
  hash:       { usage: 'hash <algo> <text>', desc: 'Hash text. e.g. .hash sha256 hello' },
  headers:    { usage: 'headers <url>', desc: 'Scan HTTP security headers of a website.' },
  hexdecode:  { usage: 'hexdecode <hex>', desc: 'Decode a hex string to text.' },
  hexencode:  { usage: 'hexencode <text>', desc: 'Encode text as a hex string.' },
  iplookup:   { usage: 'iplookup <ip>', desc: 'Look up geolocation and info for an IP address.' },
  macinfo:    { usage: 'macinfo <mac>', desc: 'Look up the vendor for a MAC address.' },
  numlookup:  { usage: 'numlookup <+number>', desc: 'Get info about a phone number. e.g. .numlookup +254712345678' },
  portinfo:   { usage: 'portinfo [port]', desc: 'Get info about a network port. e.g. .portinfo 443' },
  rot47:      { usage: 'rot47 <text>', desc: 'Apply ROT47 cipher to text.' },
  scamalyze:  { usage: 'scamalyze <message or url>', desc: 'Detect if a message or URL is a scam.' },
  sslcheck:   { usage: 'sslcheck <domain>', desc: 'Check the SSL certificate grade of a domain.' },
  subdomains: { usage: 'subdomains <domain>', desc: 'Find subdomains for a domain.' },
  urlinfo:    { usage: 'urlinfo <url>', desc: 'Expand a short URL and trace its redirects.' },
  whois:      { usage: 'whois <domain>', desc: 'Run a WHOIS lookup on a domain.' },

  // Games
  '8ball':    { usage: '8ball <question>', desc: 'Ask the magic 8-ball a yes/no question.' },
  coinflip:   { usage: 'coinflip', desc: 'Flip a coin — heads or tails.' },
  dare:       { usage: 'dare', desc: 'Get a random dare challenge.' },
  dice:       { usage: 'dice', desc: 'Roll a six-sided dice.' },
  fact:       { usage: 'fact', desc: 'Get a random interesting fact.' },
  joke:       { usage: 'joke', desc: 'Get a random joke.' },
  quote:      { usage: 'quote', desc: 'Get an inspirational quote.' },
  trivia:     { usage: 'trivia', desc: 'Start a trivia quiz question.' },
  truth:      { usage: 'truth', desc: 'Get a random truth question.' },
};

async function help(ctx) {
  const { sock, from, msg, prefix, args } = ctx;
  const p = prefix || process.env.PREFIX || '.';
  const query = args[0]?.toLowerCase().replace(/^\./, '');

  if (!query) return menu(ctx);

  const entry = HELP[query];
  if (!entry) {
    await sock.sendMessage(from, {
      text: `❌ No help found for *${p}${query}*\n\nType *${p}menu* to see all commands.`
    }, { quoted: msg });
    return;
  }

  await sock.sendMessage(from, {
    text: `📖 *${p}${entry.usage}*\n\n${entry.desc}`
  }, { quoted: msg });
}

async function ping2(ctx) {
  const { sock, from, msg, sessionState } = ctx;
  const { performance } = require('perf_hooks');
  const os = require('os');
  const start = performance.now();
  await sock.sendMessage(from, { text: '🏓 _Measuring..._' }, { quoted: msg });
  const ms = (performance.now() - start).toFixed(2);
  const mem = process.memoryUsage();
  const cpus = os.cpus();
  const load = os.loadavg()[0].toFixed(2);
  const uptime = getUptime();
  await sock.sendMessage(from, {
    text: `🏓 *Ping 2 — Detailed Stats*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `⚡ *Latency:* ${ms}ms\n` +
      `💾 *RAM:* ${(mem.rss / 1024 / 1024).toFixed(1)}MB used\n` +
      `🔄 *Heap:* ${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB\n` +
      `💻 *CPU Load:* ${load} avg\n` +
      `🖥️ *Cores:* ${cpus.length} × ${cpus[0]?.model?.split(' ').slice(-1)[0] || 'CPU'}\n` +
      `⏱️ *Uptime:* ${uptime}\n` +
      `📊 *Messages:* ${sessionState.messageCount}\n` +
      `⚡ *Commands:* ${sessionState.commandCount}\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n_Node.js ${process.version}_`
  }, { quoted: msg });
}

async function botstatus(ctx) {
  const { sock, from, msg, sessionState } = ctx;
  const os = require('os');
  const mem = process.memoryUsage();
  const mode = db.getBotSetting('botMode') || 'public';
  const prefix = process.env.PREFIX || '.';
  const botName = db.getBotSetting('botName') || 'Firebox';
  const ownerName = db.getBotSetting('ownerName') || process.env.OWNER_NAME || 'Owner';

  const flags = [
    ['🌐 Mode',           mode === 'private' ? '🔒 PRIVATE' : '🌍 PUBLIC'],
    ['🤖 Chatbot',        db.getBotSetting('aiChatbot') ? '✅ ON' : '❌ OFF'],
    ['👁️ Auto View Status', db.getBotSetting('autoViewStatus') ? '✅ ON' : '❌ OFF'],
    ['💚 Auto React Status', db.getBotSetting('autoReactStatus') ? '✅ ON' : '❌ OFF'],
    ['🗑️ Anti Delete',   db.getBotSetting('antiDelete') ? '✅ ON' : '❌ OFF'],
    ['✏️ Anti Edit',     db.getBotSetting('antiEdit') ? '✅ ON' : '❌ OFF'],
    ['📞 Anti Call',     db.getBotSetting('antiCall') ? '✅ ON' : '❌ OFF'],
    ['💤 Always Online', db.getBotSetting('alwaysOnline') ? '✅ ON' : '❌ OFF'],
    ['📖 Auto Read',     db.getBotSetting('autoRead') ? '✅ ON' : '❌ OFF'],
  ];

  const statusLines = flags.map(([k, v]) => `${k}: ${v}`).join('\n');

  await sock.sendMessage(from, {
    text: `🔥 *${botName} — Bot Status*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `👤 *Owner:* ${ownerName}\n` +
      `🏷️ *Prefix:* ${prefix}\n` +
      `⏱️ *Uptime:* ${getUptime()}\n` +
      `💾 *RAM:* ${(mem.rss / 1024 / 1024).toFixed(1)} MB\n` +
      `📊 *Messages handled:* ${sessionState.messageCount}\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n${statusLines}\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`
  }, { quoted: msg });
}

async function pair(ctx) {
  const { sock, from, msg } = ctx;
  const botNum = sock.user?.id?.split(':')[0] || '?';
  const botName = db.getBotSetting('botName') || 'Firebox';
  await sock.sendMessage(from, {
    text: `🔥 *${botName} — Pairing Info*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `📱 *Bot Number:* +${botNum}\n` +
      `⏱️ *Uptime:* ${getUptime()}\n\n` +
      `*To deploy on a new number:*\n` +
      `1️⃣ Open the bot's web panel\n` +
      `2️⃣ Go to */pair* page\n` +
      `3️⃣ Scan QR or enter phone number for pairing code\n` +
      `4️⃣ Bot connects automatically!\n\n` +
      `*To save session:*\n` +
      `• Click *Export Session ID* on the panel\n` +
      `• Save it to deploy anywhere instantly\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`
  }, { quoted: msg });
}

async function repo(ctx) {
  const { sock, from, msg } = ctx;
  await sock.sendMessage(from, {
    text: `📦 *Firebox WhatsApp Bot*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🔥 *Name:* Firebox Bot\n` +
      `🏷️ *Version:* v2.0.0\n` +
      `🤖 *Engine:* @whiskeysockets/baileys\n` +
      `💡 *Language:* Node.js\n` +
      `🧠 *AI:* Google Gemini 2.0 Flash\n\n` +
      `📋 *Features:*\n` +
      `• 200+ commands across all categories\n` +
      `• AI chat, image generation, audio effects\n` +
      `• Group management & auto-mod\n` +
      `• Downloads: YT, TikTok, IG, FB, Twitter\n` +
      `• Ephoto360 image effects\n` +
      `• Bible & Quran verse lookup\n` +
      `• Session export for easy deployment\n\n` +
      `🌐 *Panel:* https://${process.env.REPL_SLUG || 'firebox'}.replit.app/pair\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n_Powered by Firebox ❤️_`
  }, { quoted: msg });
}

module.exports = { ping, ping2, menu, help, info, owner, runtime, botstatus, pair, repo };
