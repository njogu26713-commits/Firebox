// Prevent uncaught Baileys socket errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] Uncaught exception (ignored):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled rejection (ignored):', reason?.message || reason);
});

require('dotenv').config();

// ── Ensure yt-dlp is installed (needed for .play / .video commands) ───────────
const { execSync } = require('child_process');
const fs = require('fs');
const YTDLP_PATH = '/home/runner/workspace/.pythonlibs/bin/yt-dlp';
if (!fs.existsSync(YTDLP_PATH)) {
  try {
    console.log('[SETUP] Installing yt-dlp...');
    execSync('pip install -q yt-dlp', { stdio: 'inherit' });
    console.log('[SETUP] yt-dlp installed ✅');
  } catch (e) {
    console.error('[SETUP] yt-dlp install failed:', e.message);
  }
} else {
  console.log('[SETUP] yt-dlp ready ✅');
}
const db = require('./src/database');
const { startServer } = require('./src/server');
const { loadAndStartAll } = require('./src/sessionManager');

console.log('🔥 Firebox WhatsApp Bot v1.0.0');
console.log('─────────────────────────────────');
console.log('🌐 Dashboard: open the Preview tab to manage sessions\n');

db.initialize();
startServer();
loadAndStartAll().catch(console.error);
