const fs = require('fs');
const path = require('path');

// Comprehensive emoji removal — covers all major blocks
// Preserves: ▰ box-drawing (U+2500-U+257F), geometric shapes (U+25A0-U+25FF), arrows (U+2190-U+21FF), em-dash —, etc.
const EMOJI_RE = new RegExp(
  '(?:' +
  // Digit/# keycap sequences: 0-9, *, # + optional FE0F + U+20E3
  '[0-9#*]\uFE0F?\u20E3|' +
  // All standard emoji blocks
  '[\u{1F100}-\u{1FAFF}]|' +
  // Misc symbols (covers ⏱ U+23F1, ⏳ U+23F3, ⌚ etc. but NOT box/geometric/arrows)
  '[\u{2300}-\u{2307}\u{230C}-\u{231F}\u{2324}-\u{2328}\u{232B}\u{237D}-\u{237F}\u{2388}\u{23CF}\u{23E9}-\u{23FF}]|' +
  // Misc symbols block (skip box-drawing, geometric: keep those)
  '[\u{2600}-\u{27BF}]|' +
  // Other common emoji codepoints
  '[\u{2B05}-\u{2B0F}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}]|' +
  // Variation selector + ZWJ (cleanup leftovers)
  '[\uFE0F\u200D\u20E3]' +
  ')' +
  // Consume optional trailing space
  ' ?',
  'gu'
);

const dir = path.join(__dirname, 'src/commands');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

for (const file of files) {
  const fp = path.join(dir, file);
  let src = fs.readFileSync(fp, 'utf8');
  const before = src;

  // Remove emoji + optional trailing space
  src = src.replace(EMOJI_RE, '');

  // Clean up trailing space before literal \n in strings (e.g. "text \n" → "text\n")
  src = src.replace(/ \\n/g, '\\n');

  if (src !== before) {
    fs.writeFileSync(fp, src, 'utf8');
    console.log(`Updated: ${file}`);
  } else {
    console.log(`No change: ${file}`);
  }
}
