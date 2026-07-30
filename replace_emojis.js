/**
 * replace_emojis.js
 * Replaces every emoji in .js source files with a clean Unicode symbol.
 * Run once: node replace_emojis.js
 */

const fs   = require('fs');
const path = require('path');

// ── Emoji → Unicode symbol map ─────────────────────────────────────────────
// Order matters: longer / multi-codepoint sequences first.
const MAP = [
  // ── multi-codepoint sequences (ZWJ / variation-selector) ──────────────
  ['\u26A0\uFE0F',   '▲'],   // ⚠️  warning sign + VS16
  ['\u270F\uFE0F',   '✎'],   // ✏️  pencil + VS16
  ['\u1F5D1\uFE0F',  '✖'],   // 🗑️  wastebasket + VS16
  ['\u1F6E0\uFE0F',  '[#]'], // 🛠️  tools + VS16
  ['\u1F5BC\uFE0F',  '[IMG]'], // 🖼️  picture frame + VS16
  ['\u2764\uFE0F',   '\u2665'], // ❤️  heart + VS16 → ♥
  ['\u2744\uFE0F',   '*'],   // ❄️  snowflake + VS16

  // ── single-codepoint emoji ──────────────────────────────────────────────
  ['\u{1F525}', '\u2605'],   // 🔥 → ★
  ['\u2705',    '\u2713'],   // ✅ → ✓
  ['\u274C',    '\u2717'],   // ❌ → ✗
  ['\u26A0',    '\u25B2'],   // ⚠  → ▲  (bare, no VS16)
  ['\u270F',    '\u270E'],   // ✏  → ✎  (bare)
  ['\u{1F512}', '[LOCK]'],  // 🔒
  ['\u{1F504}', '\u21BB'],   // 🔄 → ↻
  ['\u{1F4A1}', '\u25BA'],   // 💡 → ►
  ['\u{1F4E2}', '\u00BB'],   // 📢 → »
  ['\u{1F517}', '\u2192'],   // 🔗 → →
  ['\u{1F44B}', '~'],        // 👋
  ['\u{1F64F}', '~'],        // 🙏
  ['\u{1F480}', '[DEAD]'],   // 💀
  ['\u{1F389}', '\u2605'],   // 🎉 → ★
  ['\u{1F310}', '[WEB]'],    // 🌐
  ['\u{1F7E2}', '\u25CF'],   // 🟢 → ●  (filled)
  ['\u{1F7E1}', '\u25D1'],   // 🟡 → ◑  (half)
  ['\u{1F7E4}', '\u25CB'],   // 🔴 → ○  (empty)
  ['\u2795',    '+'],         // ➕
  ['\u2796',    '-'],         // ➖
  ['\u{1F527}', '[=]'],      // 🔧
  ['\u{1F464}', '[USER]'],   // 👤
  ['\u{1F5D1}', '\u2716'],   // 🗑  (bare)
  ['\u{1F4F7}', '[PIC]'],    // 📷
  ['\u{1F4F8}', '[PIC]'],    // 📸
  ['\u{1F3AC}', '\u25BA'],   // 🎬 → ►
  ['\u{1F4FD}', '\u25BA'],   // 🎥 → ►
  ['\u{1F3A4}', '\u266A'],   // 🎤 → ♪
  ['\u{1F3AD}', '[STK]'],    // 🎭
  ['\u270E',    '\u270E'],   // ✎  (already correct — no-op guard)
  ['\u{1F4DD}', '\u25BA'],   // 📝 → ►  (note)
  ['\u{1F4AC}', '\u00BB'],   // 💬 → »
  ['\u{1F4B0}', '$'],        // 💰
  ['\u{1FA99}', '$'],        // 🪙
  ['\u{1F4CA}', '[#]'],      // 📊
  ['\u{1F916}', '[AI]'],     // 🤖
  ['\u{1F3A8}', '[ART]'],    // 🎨
  ['\u{1F3B5}', '\u266A'],   // 🎵 → ♪
  ['\u{1F50D}', '[?]'],      // 🔍
  ['\u2728',    '*'],         // ✨
  ['\u{1F465}', '[GRP]'],    // 👥
  ['\u{1F535}', '\u25CF'],   // 🔵 → ●
  ['\u26EA',    '+'],         // ⛪
  ['\u{1F4BB}', '[>_]'],     // 💻
  ['\u{1F4AF}', '[!]'],      // 💯
  ['\u25B6',    '\u25BA'],   // ▶  → ►  (filled)
  // ── additional missed emoji ───────────────────────────────────────────────
  ['\u{1F534}', '\u25CB'],   // 🔴 → ○  (red circle)
  ['\u{1F4F1}', '[MOB]'],    // 📱
  ['\u{1F3F7}\uFE0F', '[TAG]'], // 🏷️
  ['\u{1F3F7}', '[TAG]'],    // 🏷  bare
  ['\u{1F4CE}', '[CLIP]'],   // 📎
  ['\u{1F4F5}', '[NO-MOB]'], // 📵
  ['\u26A1',    '\u26A1'],   // ⚡  already in non-emoji range — no-op guard
  ['\u2716\uFE0F', '\u2716'], // ✖️  → ✖  (strip VS16)
  ['\u{1F3A5}', '\u25BA'],   // 🎥 → ►
  ['\u{1F629}', '[!]'],      // 😩
  ['\u{1F914}', '[?]'],      // 🤔
  ['\u{1F440}', '[..]'],     // 👀
  ['\u{1F979}', '[!]'],      // 🥹
  ['\u{1F60D}', '[<3]'],     // 😍
  ['\u{1F602}', '[LOL]'],    // 😂
  ['\u{1F44F}', '[^^]'],     // 👏
  ['\u{1F973}', '[YAY]'],    // 🥳
  ['\u{1F60E}', '[OK]'],     // 😎
  ['\u{1F4AA}', '[STR]'],    // 💪
  ['\u{1F929}', '[WOW]'],    // 🤩
  ['\u{1F61C}', '[FUN]'],    // 😜
  ['\u{1F64C}', '[^^]'],     // 🙌
  ['\u{1F4A5}', '[!]'],      // 💥
  ['\u{1F624}', '[!]'],      // 😤
];

// Collect all JS files to process
const TARGETS = [
  'index.js',
  'src/card.js',
  'src/database.js',
  'src/handler.js',
  'src/menuImage.js',
  'src/sessionManager.js',
  'src/state.js',
  'src/openrouter.js',
  'src/server.js',
  'src/mpesa.js',
  ...fs.readdirSync('src/commands').filter(f => f.endsWith('.js')).map(f => `src/commands/${f}`),
];

let changed = 0;
let unchanged = 0;

for (const rel of TARGETS) {
  const fp = path.join(__dirname, rel);
  if (!fs.existsSync(fp)) { console.log(`  SKIP (missing): ${rel}`); continue; }

  let src = fs.readFileSync(fp, 'utf8');
  let out = src;

  for (const [emoji, replacement] of MAP) {
    // Use a regex so we can replace all occurrences
    const re = new RegExp(emoji, 'gu');
    out = out.replace(re, replacement);
  }

  if (out !== src) {
    fs.writeFileSync(fp, out, 'utf8');
    console.log(`  UPDATED: ${rel}`);
    changed++;
  } else {
    console.log(`  no change: ${rel}`);
    unchanged++;
  }
}

console.log(`\nDone. ${changed} file(s) updated, ${unchanged} already clean.`);
