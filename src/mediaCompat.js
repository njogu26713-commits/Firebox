/**
 * Media compatibility helpers — Evolution API edition
 * Drop-in replacements for the Baileys helper functions used by command modules.
 */

'use strict';

/**
 * getContentType — identify the primary message type from a Baileys/Evolution API
 * message object (same logic as Baileys' own getContentType).
 */
function getContentType(message) {
  if (!message || typeof message !== 'object') return undefined;
  const keys = Object.keys(message);
  const order = [
    'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage',
    'documentMessage', 'extendedTextMessage', 'conversation',
    'buttonsResponseMessage', 'listResponseMessage', 'interactiveResponseMessage',
    'reactionMessage', 'protocolMessage', 'pollUpdateMessage', 'editedMessage',
    'contactMessage', 'locationMessage', 'liveLocationMessage',
    'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
    'ephemeralMessage', 'deviceSentMessage', 'ptvMessage',
  ];
  for (const t of order) {
    if (keys.includes(t)) return t;
  }
  return keys[0];
}

/**
 * downloadMediaBuffer — download media from a message using the sock adapter.
 * Returns a Buffer or null.
 *
 * @param {object} sock        - Evolution API sock adapter
 * @param {object} msg         - Full message object (with key + message)
 * @param {object} [altMessage] - Optional alternate message content (e.g. quotedMessage).
 *                                If provided, builds a synthetic key from msg.
 */
async function downloadMediaBuffer(sock, msg, altMessage) {
  const targetMsg = altMessage
    ? { key: msg.key, message: altMessage }
    : msg;

  const buffer = await sock.downloadMediaMessage(targetMsg);
  return buffer; // Buffer or null
}

module.exports = { getContentType, downloadMediaBuffer };
