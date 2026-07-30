// Prevent uncaught Baileys socket errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] Uncaught exception (ignored):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled rejection (ignored):', reason?.message || reason);
});

require('dotenv').config();

// ── Ensure yt-dlp is available (needed for .play / .video commands) ──────────
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// Portable binary path — works on Replit, Railway, and any Linux host
const BIN_DIR   = path.join(__dirname, 'bin');
const YTDLP_BIN = path.join(BIN_DIR, 'yt-dlp');

if (!fs.existsSync(YTDLP_BIN)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // 1. Try pip first (works on Replit which has Python)
  const pipCandidates = ['pip3', 'pip', 'python3 -m pip', 'python -m pip'];
  let installed = false;
  for (const pip of pipCandidates) {
    try {
      execSync(`${pip} install -q yt-dlp`, { stdio: 'inherit' });
      // pip installs to a system/user bin — find it and symlink/copy to ./bin/yt-dlp
      const which = execSync('which yt-dlp 2>/dev/null || find ~/.local/bin /home -name yt-dlp 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
      if (which && fs.existsSync(which)) {
        fs.copyFileSync(which, YTDLP_BIN);
        fs.chmodSync(YTDLP_BIN, 0o755);
        installed = true;
        break;
      }
    } catch (_) {}
  }

  // 2. Fall back to downloading the standalone binary (no Python needed — works on Railway)
  if (!installed) {
    try {
      console.log('[SETUP] Downloading yt-dlp standalone binary...');
      execSync(
        `curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${YTDLP_BIN}" && chmod +x "${YTDLP_BIN}"`,
        { stdio: 'inherit', timeout: 60000 }
      );
      installed = fs.existsSync(YTDLP_BIN);
    } catch (e) {
      console.error('[SETUP] yt-dlp binary download failed:', e.message);
    }
  }

  if (installed) {
    console.log('[SETUP] yt-dlp ready ✅');
  } else {
    console.warn('[SETUP] yt-dlp could not be installed — .play/.video commands may not work');
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

// Initialize DB (connects to MongoDB, syncs data) then start everything
db.initialize()
  .then(() => {
    startServer();
    loadAndStartAll().catch(console.error);
  })
  .catch(err => {
    console.error('[DB] Initialization error — starting anyway:', err.message);
    startServer();
    loadAndStartAll().catch(console.error);
  });
