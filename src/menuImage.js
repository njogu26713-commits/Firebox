const { createCanvas } = require('@napi-rs/canvas');

const W = 960;
const COL_COUNT = 3;
const PAD = 28;
const HEADER_H = 170;
const COL_GAP = 16;
const SECTION_RADIUS = 14;
const FOOTER_H = 52;

const CATS = [
  { icon: '🤖', title: 'AI Chat',       cmds: ['.ai','.analyze','.code','.translate','.story','.summarize','.simi','.doppleai','.recipe','.teach'] },
  { icon: '🎨', title: 'AI Image',      cmds: ['.generate','.dalle'] },
  { icon: '🎵', title: 'Download',      cmds: ['.play','.video','.song','.tiktok','.instagram','.facebook','.twitter','.pinterest','.savestatus','.wallpaper','.apk'] },
  { icon: '🔍', title: 'Search',        cmds: ['.lyrics','.songinfo','.shazam','.weather','.define','.imdb','.yts'] },
  { icon: '🛠️', title: 'Tools',         cmds: ['.sticker','.toimg','.vv','.tts','.read','.qrcode','.tinyurl','.getpp','.genpass','.calculate','.fancy','.emojimix'] },
  { icon: '✨', title: 'Fun',           cmds: ['.joke','.fact','.quote','.memes','.8ball','.truth','.dare','.trivia','.dice','.coinflip','.compliment','.roast','.wyr','.riddle'] },
  { icon: '🖼️', title: 'Image FX',     cmds: ['.blur','.cartoon','.anime','.sketch','.neon','.glitch','.wasted','.wanted','.sepia','.invert','.watercolor','.oil','.fire','.snow'] },
  { icon: '🎵', title: 'Audio FX',      cmds: ['.bass','.blown','.deep','.earrape','.robot','.reverseaudio','.tomp3','.toptt','.volaudio'] },
  { icon: '👥', title: 'Group',         cmds: ['.tagall','.hidetag','.tagadmin','.kick','.add','.promote','.demote','.mute','.unmute','.poll','.warn','.antilink','.setwelcome'] },
  { icon: '🔵', title: 'General',       cmds: ['.ping','.info','.owner','.runtime','.botstatus','.help','.repo'] },
  { icon: '⛪', title: 'Religion',      cmds: ['.bible','.quran'] },
  { icon: '🎮', title: 'Games',         cmds: ['.rps','.guess','.truthdetector','.anon','.confess','.reverse','.morse','.binary','.age','.countdown'] },
];

function measureCatHeight(ctx, cat, colW) {
  const titleH = 30;
  const lineH = 22;
  const innerPad = 12;
  const itemsPerRow = 2;
  const rows = Math.ceil(cat.cmds.length / itemsPerRow);
  return titleH + innerPad + rows * lineH + innerPad * 2;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSection(ctx, cat, x, y, w, totalH) {
  const innerPad = 12;
  const titleH = 30;
  const lineH = 22;
  const itemsPerRow = 2;
  const itemW = (w - innerPad * 2) / itemsPerRow;

  // Card background
  drawRoundRect(ctx, x, y, w, totalH, SECTION_RADIUS);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();

  // Card border
  drawRoundRect(ctx, x, y, w, totalH, SECTION_RADIUS);
  ctx.strokeStyle = 'rgba(255,140,0,0.18)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Title bar gradient
  drawRoundRect(ctx, x, y, w, titleH, SECTION_RADIUS);
  const tgrad = ctx.createLinearGradient(x, y, x + w, y);
  tgrad.addColorStop(0, 'rgba(255,100,0,0.25)');
  tgrad.addColorStop(1, 'rgba(255,60,0,0.08)');
  ctx.fillStyle = tgrad;
  ctx.fill();

  // Title text
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#ff8c00';
  ctx.fillText(`${cat.icon}  ${cat.title}`, x + innerPad, y + 19);

  // Commands
  ctx.font = '11.5px monospace';
  ctx.fillStyle = '#c8d6e5';
  const cmdY = y + titleH + innerPad;
  cat.cmds.forEach((cmd, i) => {
    const col = i % itemsPerRow;
    const row = Math.floor(i / itemsPerRow);
    const cx = x + innerPad + col * itemW;
    const cy = cmdY + row * lineH;
    ctx.fillStyle = 'rgba(255,140,0,0.7)';
    ctx.fillText('›', cx, cy + 11);
    ctx.fillStyle = '#c8d6e5';
    ctx.fillText(cmd, cx + 10, cy + 11);
  });
}

async function generateMenuImage(botName, prefix, userNumber) {
  // Calculate column layout
  const colW = Math.floor((W - PAD * 2 - COL_GAP * (COL_COUNT - 1)) / COL_COUNT);

  // Assign each category to columns (fill columns top-to-bottom)
  const tmpCanvas = createCanvas(10, 10);
  const tmpCtx = tmpCanvas.getContext('2d');
  const catHeights = CATS.map(cat => measureCatHeight(tmpCtx, cat, colW));

  // Distribute into 3 columns greedily (try to balance heights)
  const cols = [[], [], []];
  const colTotals = [0, 0, 0];
  CATS.forEach((cat, i) => {
    const h = catHeights[i] + COL_GAP;
    const minCol = colTotals.indexOf(Math.min(...colTotals));
    cols[minCol].push({ cat, h: catHeights[i] });
    colTotals[minCol] += h;
  });

  const contentH = Math.max(...colTotals) + PAD;
  const totalH = HEADER_H + contentH + FOOTER_H;

  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext('2d');

  // ── Background ─────────────────────────────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, totalH);
  bg.addColorStop(0,   '#0d0d0d');
  bg.addColorStop(0.5, '#111118');
  bg.addColorStop(1,   '#0a0a0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, totalH);

  // Subtle orange glow top-left
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 480);
  glow.addColorStop(0, 'rgba(255,80,0,0.12)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, totalH);

  // ── Header ─────────────────────────────────────────────────────────────────
  // Top accent bar
  const accentGrad = ctx.createLinearGradient(0, 0, W, 0);
  accentGrad.addColorStop(0,   '#ff4500');
  accentGrad.addColorStop(0.5, '#ff8c00');
  accentGrad.addColorStop(1,   '#ff4500');
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, 0, W, 4);

  // Bot name
  ctx.font = 'bold 52px sans-serif';
  const nameGrad = ctx.createLinearGradient(PAD, 0, PAD + 300, 0);
  nameGrad.addColorStop(0, '#ff6a00');
  nameGrad.addColorStop(1, '#ffcc00');
  ctx.fillStyle = nameGrad;
  ctx.fillText(`🔥 ${(botName || 'FIREBOX').toUpperCase()}`, PAD, 70);

  // Subtitle
  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('WhatsApp Bot  •  Type a command to get started', PAD, 98);

  // Stats row
  ctx.font = 'bold 13px sans-serif';
  const statBadges = [
    { label: `${CATS.reduce((s,c)=>s+c.cmds.length,0)}+ Commands`, color: '#ff6a00' },
    { label: `${CATS.length} Categories`, color: '#00b4d8' },
    { label: `Prefix: ${prefix || '.'}`, color: '#06d6a0' },
  ];
  let bx = PAD;
  statBadges.forEach(b => {
    const tw = ctx.measureText(b.label).width;
    const bw = tw + 22;
    drawRoundRect(ctx, bx, 112, bw, 26, 8);
    ctx.fillStyle = b.color + '22';
    ctx.fill();
    drawRoundRect(ctx, bx, 112, bw, 26, 8);
    ctx.strokeStyle = b.color + '66';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.fillText(b.label, bx + 11, 130);
    bx += bw + 10;
  });

  // Header divider
  ctx.strokeStyle = 'rgba(255,140,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H - 10);
  ctx.lineTo(W - PAD, HEADER_H - 10);
  ctx.stroke();

  // ── Command Sections ───────────────────────────────────────────────────────
  const colX = [PAD, PAD + colW + COL_GAP, PAD + (colW + COL_GAP) * 2];
  const colY = [HEADER_H, HEADER_H, HEADER_H];

  cols.forEach((items, ci) => {
    items.forEach(({ cat, h }) => {
      drawSection(ctx, cat, colX[ci], colY[ci], colW, h);
      colY[ci] += h + COL_GAP;
    });
  });

  // ── Footer ─────────────────────────────────────────────────────────────────
  const footerY = totalH - FOOTER_H;
  ctx.fillStyle = 'rgba(255,140,0,0.06)';
  ctx.fillRect(0, footerY, W, FOOTER_H);

  ctx.strokeStyle = 'rgba(255,140,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(W, footerY);
  ctx.stroke();

  ctx.font = '13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  const footTxt = userNumber
    ? `Powered by Firebox  •  ${userNumber}`
    : 'Powered by Firebox Bot  •  Type .help <command> for details';
  ctx.fillText(footTxt, PAD, footerY + 32);

  // Bottom accent bar
  ctx.fillStyle = accentGrad;
  ctx.fillRect(0, totalH - 4, W, 4);

  return canvas.toBuffer('image/png');
}

module.exports = { generateMenuImage };
