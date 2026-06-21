// Prevent uncaught Baileys socket errors from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] Uncaught exception (ignored):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] Unhandled rejection (ignored):', reason?.message || reason);
});

require('dotenv').config();
const db = require('./src/database');
const { startServer } = require('./src/server');
const { loadAndStartAll } = require('./src/sessionManager');

console.log('🔥 Firebox WhatsApp Bot v1.0.0');
console.log('─────────────────────────────────');
console.log('🌐 Dashboard: open the Preview tab to manage sessions\n');

db.initialize();
startServer();
loadAndStartAll().catch(console.error);
