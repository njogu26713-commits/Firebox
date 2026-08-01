/**
 * Media compatibility helpers — Baileys edition
 * Drop-in replacements for the helper functions used by command modules.
 */

'use strict';

/**
 * getContentType — identify the primary message type from a Baileys message
 * object (same ordering as Baileys' own getContentType helper).
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
 * downloadMediaBuffer — download media from a message using the Baileys sock.
 * Returns a Buffer, or null on failure.
 *
 * @param {object} sock         - Baileys socket (has sock.downloadMediaMessage)
 * @param {object} msg          - Full message object (with key + message)
 * @param {object} [altMessage] - Optional alternate message content (e.g. quotedMessage).
 *                                If provided, builds a synthetic msg using the original key.
 */
async function downloadMediaBuffer(sock, msg, altMessage) {
  const targetMsg = altMessage
    ? { key: msg.key, message: altMessage }
    : msg;

  return sock.downloadMediaMessage(targetMsg);
}

module.exports = { getContentType, downloadMediaBuffer };
