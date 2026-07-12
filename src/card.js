/**
 * Firebox Interactive Card Helper
 * ─────────────────────────────────────────────────────────────────────────────
 * sendFireboxCard(sock, from, msg, opts)
 *
 * Sends a branded Firebox interactive card using Baileys native interactive
 * messages (nativeFlowMessage / cta_url buttons). Falls back to premium rich
 * text if the device/account doesn't support interactive messages.
 *
 * opts:
 *   title   {string}  Card headline shown in bold            (required)
 *   content {string}  Body text — the response               (required)
 *   footer  {string}  Optional footer override (default: bot stats line)
 *   buttons {Array}   Extra CTA buttons: [{text, url}]
 *   media   {object}  Media payload — see below
 *   noQuote {boolean} Skip quoting the original message
 *
 * media:
 *   { type: 'image'|'video'|'audio'|'document'|'sticker',
 *     buffer, mimetype, filename, ptt, caption }
 */

'use strict';

const db = require('./database');

function getUptime() {
  const s = Math.floor(process.uptime());
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

async function sendFireboxCard(sock, from, msg, opts = {}) {
  const {
    title   = '🔥 Firebox',
    content = '',
    footer,
    buttons = [],
    media   = null,
    noQuote = false,
  } = opts;

  const botName    = db.getBotSetting('botName') || 'Firebox';
  const channelLink = db.getBotSetting('channelLink') || null;
  const version    = 'v2.0.0';
  const uptime     = getUptime();

  const footerText = footer || `🔥 ${botName} ${version}  •  ⏱️ ${uptime}`;
  const baseOpts   = (!noQuote && msg) ? { quoted: msg } : {};

  /* ── Build CTA buttons ─────────────────────────────────────────────────── */
  const nativeButtons = [];
  if (channelLink) {
    nativeButtons.push({
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({
        display_text: '📢 View Channel',
        url: channelLink,
        merchant_url: channelLink,
      }),
    });
  }
  for (const btn of buttons) {
    if (btn && btn.url && btn.text) {
      nativeButtons.push({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: btn.text,
          url: btn.url,
          merchant_url: btn.url,
        }),
      });
    }
  }

  /* ── Send media (if any) first ─────────────────────────────────────────── */
  let cardOpts = baseOpts;
  if (media) {
    const mediaCap = media.caption || `🔥 *${botName}* — ${title}`;
    try {
      let payload = {};
      switch (media.type) {
        case 'image':
          payload = { image: media.buffer, caption: mediaCap };
          if (media.mimetype) payload.mimetype = media.mimetype;
          break;
        case 'video':
          payload = { video: media.buffer, caption: mediaCap, mimetype: media.mimetype || 'video/mp4' };
          break;
        case 'audio':
          payload = { audio: media.buffer, mimetype: media.mimetype || 'audio/mpeg', ptt: media.ptt || false };
          break;
        case 'document':
          payload = {
            document: media.buffer,
            mimetype: media.mimetype || 'application/octet-stream',
            caption: mediaCap,
          };
          if (media.filename) payload.fileName = media.filename;
          break;
        case 'sticker':
          payload = { sticker: media.buffer };
          break;
      }
      await sock.sendMessage(from, payload, baseOpts);
    } catch (e) {
      console.error('[CARD] Media send failed:', e.message);
    }
    // After media, send the card without quoting to avoid deep nesting
    cardOpts = {};
  }

  /* ── Try interactive message ───────────────────────────────────────────── */
  try {
    await sock.sendMessage(from, {
      interactiveMessage: {
        header: {
          title: `🔥 ${botName.toUpperCase()}`,
          subtitle: title,
          hasMediaAttachment: false,
        },
        body:   { text: content },
        footer: { text: footerText },
        nativeFlowMessage: {
          buttons: nativeButtons,
          messageParamsJson: '',
        },
      },
    }, cardOpts);
  } catch (_) {
    /* ── Fallback: premium rich text ─────────────────────────────────────── */
    const border = '━━━━━━━━━━━━━━━━━━━━';
    let text = `🔥 *${botName.toUpperCase()}*\n${border}\n*${title}*\n\n${content}\n\n${border}\n_${footerText}_`;
    if (channelLink) text += `\n\n📢 *Channel:* ${channelLink}`;
    for (const btn of buttons) {
      if (btn && btn.url) text += `\n🔗 *${btn.text}:* ${btn.url}`;
    }
    const mentionPayload = opts.mentions ? { mentions: opts.mentions } : {};
    await sock.sendMessage(from, { text, ...mentionPayload }, cardOpts);
  }
}

module.exports = { sendFireboxCard, getUptime };
