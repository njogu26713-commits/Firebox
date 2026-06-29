const { createCanvas } = require('@napi-rs/canvas');

const W          = 1080;
const PAD        = 36;
const COL_COUNT  = 3;
const COL_GAP    = 18;
const HEADER_H   = 200;
const FOOTER_H   = 64;
const CARD_RADIUS = 16;

// Category definitions — icon, title, accent color, commands
const CATS = [
  { icon:'🤖', title:'AI Chat',      color:'#7c3aed', cmds:['.ai','.ask','.simi','.code','.translate','.story','.summarize','.analyze','.recipe','.teach','.doppleai','.deepseek'] },
  { icon:'🎨', title:'AI Image',     color:'#db2777', cmds:['.generate','.dalle','.imagine'] },
  { icon:'🎵', title:'Downloads',    color:'#059669', cmds:['.play','.video','.song','.tiktok','.instagram','.facebook','.twitter','.pinterest','.savestatus','.wallpaper','.apk','.mediafire'] },
  { icon:'🔍', title:'Search',       color:'#0284c7', cmds:['.lyrics','.songinfo','.shazam','.weather','.define','.imdb','.yts'] },
  { icon:'🛠️', title:'Tools',        color:'#d97706', cmds:['.sticker','.toimg','.vv','.tts','.read','.qrcode','.tinyurl','.getpp','.genpass','.calculate','.fancy','.emojimix'] },
  { icon:'✨', title:'Fun & Games',  color:'#dc2626', cmds:['.joke','.fact','.quote','.memes','.8ball','.truth','.dare','.trivia','.dice','.coinflip','.compliment','.roast','.wyr','.riddle','.guess'] },
  { icon:'🖼️', title:'Image FX',    color:'#9333ea', cmds:['.blur','.cartoon','.anime','.sketch','.neon','.glitch','.wasted','.wanted','.sepia','.invert','.watercolor','.oil','.fire','.snow','.rainbow','.vintage'] },
  { icon:'🎵', title:'Audio FX',     color:'#0891b2', cmds:['.bass','.blown','.deep','.earrape','.robot','.reverseaudio','.tomp3','.toptt','.volaudio'] },
  { icon:'👥', title:'Group',        color:'#16a34a', cmds:['.tagall','.hidetag','.tagadmin','.kick','.add','.promote','.demote','.mute','.unmute','.poll','.warn','.antilink','.setwelcome'] },
  { icon:'🔵', title:'General',      color:'#2563eb', cmds:['.ping','.info','.owner','.runtime','.botstatus','.help','.pair','.repo'] },
  { icon:'⛪', title:'Religion',     color:'#92400e', cmds:['.bible','.quran'] },
  { icon:'💻', title:'Hacking',      color:'#15803d', cmds:['.iplookup','.whois','.dns','.hash','.checkpass','.b64encode','.b64decode','.cipher','.sslcheck','.numlookup','.scamalyze','.hack'] },
];

const TOTAL_CMDS = CATS.reduce((s, c) => s + c.cmds.length, 0);

/* ── helpers ────────────────────────────────────────────────────────────────── */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/* ── measure card height ────────────────────────────────────────────────────── */
function cardHeight(cat) {
  const TITLE_H  = 44;
  const LINE_H   = 20;
  const INNER_PY = 14;
  // 2 commands per row
  const rows = Math.ceil(cat.cmds.length / 2);
  return TITLE_H + INNER_PY + rows * LINE_H + INNER_PY;
}

/* ── draw one card ──────────────────────────────────────────────────────────── */
function drawCard(ctx, cat, x, y, w, h) {
  const { r, g, b } = hexToRgb(cat.color);
  const TITLE_H  = 44;
  const LINE_H   = 20;
  const INNER_PY = 14;
  const INNER_PX = 14;

  // Card shadow
  ctx.shadowColor = `rgba(${r},${g},${b},0.25)`;
  ctx.shadowBlur  = 18;
  ctx.shadowOffsetY = 4;

  // Card body
  rr(ctx, x, y, w, h, CARD_RADIUS);
  ctx.fillStyle = 'rgba(15,15,25,0.85)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  ctx.shadowOffsetY = 0;

  // Card border — thin, colored
  rr(ctx, x, y, w, h, CARD_RADIUS);
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Title bar
  rr(ctx, x, y, w, TITLE_H, CARD_RADIUS);
  // Only round the top
  ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
  ctx.fill();

  // Colored top accent strip
  ctx.fillStyle = cat.color;
  ctx.beginPath();
  ctx.moveTo(x + CARD_RADIUS, y);
  ctx.lineTo(x + w - CARD_RADIUS, y);
  ctx.arcTo(x + w, y, x + w, y + CARD_RADIUS, CARD_RADIUS);
  ctx.lineTo(x + w, y + 4);
  ctx.lineTo(x, y + 4);
  ctx.lineTo(x, y + CARD_RADIUS);
  ctx.arcTo(x, y, x + CARD_RADIUS, y, CARD_RADIUS);
  ctx.closePath();
  ctx.fill();

  // Title icon + text
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${cat.icon}  ${cat.title}`, x + INNER_PX, y + TITLE_H - 13);

  // Command count badge
  const badge = `${cat.cmds.length} cmds`;
  ctx.font = '10px sans-serif';
  const bw = ctx.measureText(badge).width + 12;
  const bx = x + w - INNER_PX - bw;
  const by = y + TITLE_H - 26;
  rr(ctx, bx, by, bw, 16, 8);
  ctx.fillStyle = `rgba(${r},${g},${b},0.35)`;
  ctx.fill();
  ctx.fillStyle = `rgba(${r},${g},${b},1)`;
  ctx.fillText(badge, bx + 6, by + 11);

  // Commands (2 per row)
  ctx.font = '11px monospace';
  const cmdAreaX = x + INNER_PX;
  const cmdAreaY = y + TITLE_H + INNER_PY;
  const halfW    = (w - INNER_PX * 2) / 2;

  cat.cmds.forEach((cmd, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx  = cmdAreaX + col * halfW;
    const cy  = cmdAreaY + row * LINE_H;

    // dot bullet in accent color
    ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
    ctx.beginPath();
    ctx.arc(cx + 4, cy + 6, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // command text
    ctx.fillStyle = 'rgba(220,230,240,0.88)';
    ctx.fillText(cmd, cx + 12, cy + 13);
  });
}

/* ── main export ────────────────────────────────────────────────────────────── */
async function generateMenuImage(botName, prefix, userNumber) {
  const colW = Math.floor((W - PAD * 2 - COL_GAP * (COL_COUNT - 1)) / COL_COUNT);

  // Distribute cats into 3 balanced columns
  const cols      = [[], [], []];
  const colTotals = [0, 0, 0];
  const CARD_GAP  = 16;

  CATS.forEach(cat => {
    const h = cardHeight(cat) + CARD_GAP;
    const minIdx = colTotals.indexOf(Math.min(...colTotals));
    cols[minIdx].push({ cat, h: cardHeight(cat) });
    colTotals[minIdx] += h;
  });

  const contentH = Math.max(...colTotals) + PAD;
  const totalH   = HEADER_H + contentH + FOOTER_H;

  const canvas = createCanvas(W, totalH);
  const ctx    = canvas.getContext('2d');

  /* ── BACKGROUND ─────────────────────────────────────────────────────────── */
  // Deep dark base
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, W, totalH);

  // Large radial glow — top left (orange/fire)
  {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 550);
    g.addColorStop(0,   'rgba(255,90,0,0.16)');
    g.addColorStop(0.6, 'rgba(255,60,0,0.05)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, totalH);
  }

  // Large radial glow — bottom right (purple)
  {
    const g = ctx.createRadialGradient(W, totalH, 0, W, totalH, 600);
    g.addColorStop(0,   'rgba(120,40,220,0.14)');
    g.addColorStop(0.6, 'rgba(80,20,180,0.05)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, totalH);
  }

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 60) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, totalH); ctx.stroke();
  }
  for (let gy = 0; gy < totalH; gy += 60) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  /* ── TOP ACCENT BAR ─────────────────────────────────────────────────────── */
  {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0,    '#ff4500');
    g.addColorStop(0.35, '#ff8c00');
    g.addColorStop(0.65, '#ffcc00');
    g.addColorStop(1,    '#ff4500');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 5);
  }

  /* ── HEADER ─────────────────────────────────────────────────────────────── */
  // Bot name
  ctx.shadowColor  = 'rgba(255,120,0,0.7)';
  ctx.shadowBlur   = 32;
  ctx.font         = 'bold 62px sans-serif';
  const nameGrad   = ctx.createLinearGradient(PAD, 0, PAD + 500, 0);
  nameGrad.addColorStop(0, '#ff6a00');
  nameGrad.addColorStop(0.5, '#ffcc00');
  nameGrad.addColorStop(1, '#ff8c00');
  ctx.fillStyle    = nameGrad;
  ctx.fillText(`🔥 ${(botName || 'FIREBOX').toUpperCase()} BOT`, PAD, 76);
  ctx.shadowBlur   = 0;
  ctx.shadowColor  = 'transparent';

  // Tagline
  ctx.font      = '17px sans-serif';
  ctx.fillStyle = 'rgba(200,210,230,0.55)';
  ctx.fillText('Your all-in-one WhatsApp assistant — fast, smart, powerful', PAD, 108);

  // Stat badges
  const stats = [
    { label: `${TOTAL_CMDS}+ Commands`, bg: '#ff6a0022', border: '#ff6a0066', fg: '#ff8c00' },
    { label: `${CATS.length} Categories`,  bg: '#0284c722', border: '#0284c766', fg: '#38bdf8' },
    { label: `Prefix: ${prefix || '.'}`,  bg: '#06d6a022', border: '#06d6a066', fg: '#34d399' },
    { label: 'AI Powered',                bg: '#7c3aed22', border: '#7c3aed66', fg: '#a78bfa' },
  ];
  let bx = PAD;
  const BY = 124;
  ctx.font = 'bold 12px sans-serif';
  stats.forEach(s => {
    const tw = ctx.measureText(s.label).width;
    const bw = tw + 24;
    rr(ctx, bx, BY, bw, 28, 9);
    ctx.fillStyle = s.bg;   ctx.fill();
    rr(ctx, bx, BY, bw, 28, 9);
    ctx.strokeStyle = s.border; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = s.fg;
    ctx.fillText(s.label, bx + 12, BY + 18);
    bx += bw + 10;
  });

  // Header bottom divider
  {
    const g = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
    g.addColorStop(0,   'rgba(255,140,0,0)');
    g.addColorStop(0.2, 'rgba(255,140,0,0.4)');
    g.addColorStop(0.8, 'rgba(255,140,0,0.4)');
    g.addColorStop(1,   'rgba(255,140,0,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, HEADER_H - 12);
    ctx.lineTo(W - PAD, HEADER_H - 12);
    ctx.stroke();
  }

  /* ── COMMAND CARDS ──────────────────────────────────────────────────────── */
  const colX = [
    PAD,
    PAD + colW + COL_GAP,
    PAD + (colW + COL_GAP) * 2
  ];
  const colY = [HEADER_H, HEADER_H, HEADER_H];

  cols.forEach((items, ci) => {
    items.forEach(({ cat, h }) => {
      drawCard(ctx, cat, colX[ci], colY[ci], colW, h);
      colY[ci] += h + CARD_GAP;
    });
  });

  /* ── FOOTER ─────────────────────────────────────────────────────────────── */
  const fy = totalH - FOOTER_H;

  // Footer background
  {
    const g = ctx.createLinearGradient(0, fy, 0, totalH);
    g.addColorStop(0, 'rgba(255,100,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(0, fy, W, FOOTER_H);
  }

  // Footer divider
  {
    const g = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
    g.addColorStop(0,   'rgba(255,140,0,0)');
    g.addColorStop(0.2, 'rgba(255,140,0,0.3)');
    g.addColorStop(0.8, 'rgba(255,140,0,0.3)');
    g.addColorStop(1,   'rgba(255,140,0,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
  }

  ctx.font      = '13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  const footLeft = `⚡ Powered by Firebox Bot  •  Type ${prefix || '.'}help <cmd> for details`;
  ctx.fillText(footLeft, PAD, fy + 38);

  if (userNumber) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    const footRight = `👤 ${userNumber}`;
    const rw = ctx.measureText(footRight).width;
    ctx.fillText(footRight, W - PAD - rw, fy + 38);
  }

  // Bottom accent bar
  {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0,    '#ff4500');
    g.addColorStop(0.35, '#ff8c00');
    g.addColorStop(0.65, '#ffcc00');
    g.addColorStop(1,    '#ff4500');
    ctx.fillStyle = g;
    ctx.fillRect(0, totalH - 5, W, 5);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateMenuImage };
