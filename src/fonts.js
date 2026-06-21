const BOLD_MAP = {};
const ITALIC_MAP = {};
const BOLD_ITALIC_MAP = {};
const MONO_MAP = {};
const DOUBLE_MAP = {};
const SMALL_CAPS = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ';

for (let i = 0; i < 26; i++) {
  const upper = String.fromCharCode(65 + i);
  const lower = String.fromCharCode(97 + i);
  BOLD_MAP[upper]        = String.fromCodePoint(0x1D400 + i);
  BOLD_MAP[lower]        = String.fromCodePoint(0x1D41A + i);
  ITALIC_MAP[upper]      = String.fromCodePoint(0x1D434 + i);
  ITALIC_MAP[lower]      = i === 6 ? 'ℎ' : String.fromCodePoint(0x1D44E + i);
  BOLD_ITALIC_MAP[upper] = String.fromCodePoint(0x1D468 + i);
  BOLD_ITALIC_MAP[lower] = String.fromCodePoint(0x1D482 + i);
  MONO_MAP[upper]        = String.fromCodePoint(0x1D670 + i);
  MONO_MAP[lower]        = String.fromCodePoint(0x1D68A + i);
  DOUBLE_MAP[upper]      = String.fromCodePoint(0x1D538 + i);
  DOUBLE_MAP[lower]      = String.fromCodePoint(0x1D552 + i);
}

for (let i = 0; i < 10; i++) {
  BOLD_MAP[String(i)]   = String.fromCodePoint(0x1D7CE + i);
  MONO_MAP[String(i)]   = String.fromCodePoint(0x1D7F6 + i);
  DOUBLE_MAP[String(i)] = String.fromCodePoint(0x1D7D8 + i);
}

const DOUBLE_OVERRIDES = { C:'ℂ', H:'ℍ', N:'ℕ', P:'ℙ', Q:'ℚ', R:'ℝ', Z:'ℤ' };
Object.assign(DOUBLE_MAP, DOUBLE_OVERRIDES);

function applyMap(map, text) {
  return text.split('').map(c => map[c] || c).join('');
}

const fonts = {
  bold:      t => applyMap(BOLD_MAP, t),
  italic:    t => applyMap(ITALIC_MAP, t),
  boldItalic:t => applyMap(BOLD_ITALIC_MAP, t),
  mono:      t => applyMap(MONO_MAP, t),
  double:    t => applyMap(DOUBLE_MAP, t),
  smallCaps: t => t.toLowerCase().split('').map((c, i) => {
    const idx = c.charCodeAt(0) - 97;
    return idx >= 0 && idx < 26 ? SMALL_CAPS[idx] : c;
  }).join(''),
  title: t => t.split(' ').map(w =>
    w.length ? applyMap(BOLD_MAP, w[0].toUpperCase()) + applyMap(BOLD_MAP, w.slice(1).toLowerCase()) : w
  ).join(' '),
};

module.exports = fonts;
