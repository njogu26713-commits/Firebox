/**
 * Evolution API Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates a sock-compatible interface that translates Baileys-style calls into
 * Evolution API REST requests. Drop-in replacement for the Baileys socket.
 */

'use strict';

const axios = require('axios');

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeJid(jid) {
  if (!jid) return jid;
  // Strip :0 or :XX suffix that Baileys sometimes adds
  return jid.replace(/:\d+@/, '@');
}

function jidToNumber(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

function bufferToBase64(buf) {
  if (!buf) return null;
  if (Buffer.isBuffer(buf)) return buf.toString('base64');
  if (typeof buf === 'string') return buf; // assume already base64
  return null;
}

// ── Evolution API client factory ─────────────────────────────────────────────

function createEvoClient(apiUrl, apiKey) {
  const client = axios.create({
    baseURL: apiUrl.replace(/\/$/, ''),
    headers: {
      'apikey': apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
  return client;
}

// ── send a message — core function ───────────────────────────────────────────

async function evoSendMessage(client, instance, jid, payload, opts = {}) {
  const number = normalizeJid(jid);
  const quotedKey = opts?.quoted?.key || null;
  const quoted = quotedKey ? {
    key: {
      id:        quotedKey.id,
      remoteJid: normalizeJid(quotedKey.remoteJid),
      fromMe:    quotedKey.fromMe,
      participant: quotedKey.participant ? normalizeJid(quotedKey.participant) : undefined,
    },
    message: opts.quoted.message || {},
  } : undefined;

  // ── Delete message ──────────────────────────────────────────────────────────
  if (payload.delete) {
    try {
      await client.delete(`/chat/deleteMessage/${instance}`, {
        data: {
          id:           payload.delete.id,
          remoteJid:    normalizeJid(payload.delete.remoteJid || jid),
          fromMe:       payload.delete.fromMe !== undefined ? payload.delete.fromMe : true,
          participant:  payload.delete.participant ? normalizeJid(payload.delete.participant) : undefined,
        },
      });
    } catch (e) {
      console.error('[EVO] Delete failed:', e?.response?.data || e.message);
    }
    return;
  }

  // ── React to message ────────────────────────────────────────────────────────
  if (payload.react) {
    try {
      await client.post(`/message/sendReaction/${instance}`, {
        key: {
          id:          payload.react.key.id,
          remoteJid:   normalizeJid(payload.react.key.remoteJid || jid),
          fromMe:      payload.react.key.fromMe,
          participant: payload.react.key.participant ? normalizeJid(payload.react.key.participant) : undefined,
        },
        reaction: payload.react.text || '',
      });
    } catch (e) {
      console.error('[EVO] React failed:', e?.response?.data || e.message);
    }
    return;
  }

  // ── Text message ────────────────────────────────────────────────────────────
  if (payload.text !== undefined) {
    const body = {
      number,
      text:     payload.text,
      mentions: payload.mentions || [],
    };
    if (quoted) body.quoted = quoted;
    try {
      await client.post(`/message/sendText/${instance}`, body);
    } catch (e) {
      console.error('[EVO] sendText failed:', e?.response?.data || e.message);
      throw e;
    }
    return;
  }

  // ── Interactive message — fall back to plain text ───────────────────────────
  if (payload.interactiveMessage) {
    const im = payload.interactiveMessage;
    const bodyText = im.body?.text || '';
    const footer   = im.footer?.text || '';
    let text = bodyText;
    if (footer) text += `\n\n${footer}`;
    // Extract CTA button URLs
    for (const btn of (im.nativeFlowMessage?.buttons || [])) {
      try {
        const p = JSON.parse(btn.buttonParamsJson || '{}');
        if (p.url && p.display_text) text += `\n→ *${p.display_text}:* ${p.url}`;
      } catch {}
    }
    const body = { number, text };
    if (quoted) body.quoted = quoted;
    try {
      await client.post(`/message/sendText/${instance}`, body);
    } catch (e) {
      console.error('[EVO] sendText (interactive fallback) failed:', e?.response?.data || e.message);
    }
    return;
  }

  // ── Image ────────────────────────────────────────────────────────────────────
  if (payload.image) {
    const b64 = bufferToBase64(payload.image);
    const body = {
      number,
      mediatype: 'image',
      mimetype:  payload.mimetype || 'image/jpeg',
      caption:   payload.caption || '',
      media:     b64,
      mentions:  payload.mentions || [],
    };
    if (quoted) body.quoted = quoted;
    try {
      await client.post(`/message/sendMedia/${instance}`, body);
    } catch (e) {
      console.error('[EVO] sendMedia(image) failed:', e?.response?.data || e.message);
      throw e;
    }
    return;
  }

  // ── Video ────────────────────────────────────────────────────────────────────
  if (payload.video) {
    const b64 = bufferToBase64(payload.video);
    const body = {
      number,
      mediatype: 'video',
      mimetype:  payload.mimetype || 'video/mp4',
      caption:   payload.caption || '',
      media:     b64,
      mentions:  payload.mentions || [],
    };
    if (quoted) body.quoted = quoted;
    try {
      await client.post(`/message/sendMedia/${instance}`, body);
    } catch (e) {
      console.error('[EVO] sendMedia(video) failed:', e?.response?.data || e.message);
      throw e;
    }
    return;
  }

  // ── Audio / Voice note ───────────────────────────────────────────────────────
  if (payload.audio) {
    const b64 = bufferToBase64(payload.audio);
    const body = {
      number,
      audio:    b64,
      encoding: true,
    };
    if (quoted) body.quoted = quoted;
    try {
      if (payload.ptt) {
        await client.post(`/message/sendWhatsAppAudio/${instance}`, body);
      } else {
        // Regular audio as media
        await client.post(`/message/sendMedia/${instance}`, {
          number,
          mediatype: 'audio',
          mimetype:  payload.mimetype || 'audio/mpeg',
          media:     b64,
          quoted,
        });
      }
    } catch (e) {
      console.error('[EVO] sendAudio failed:', e?.response?.data || e.message);
      throw e;
    }
    return;
  }

  // ── Sticker ──────────────────────────────────────────────────────────────────
  if (payload.sticker) {
    const b64 = bufferToBase64(payload.sticker);
    const body = { number, sticker: b64 };
    if (quoted) body.quoted = quoted;
    try {
      await client.post(`/message/sendSticker/${instance}`, body);
    } catch (e) {
      console.error('[EVO] sendSticker failed:', e?.response?.data || e.message);
      throw e;
    }
    return;
  }

  // ── Document ─────────────────────────────────────────────────────────────────
  if (payload.document) {
    const b64 = bufferToBase64(payload.document);
    const body = {
      number,
      mediatype: 'document',
      mimetype:  payload.mimetype || 'application/octet-stream',
      caption:   payload.caption || '',
      fileName:  payload.fileName || 'file',
      media:     b64,
    };
    if (quoted) body.quoted = quoted;
    try {
      await client.post(`/message/sendMedia/${instance}`, body);
    } catch (e) {
      console.error('[EVO] sendMedia(document) failed:', e?.response?.data || e.message);
      throw e;
    }
    return;
  }

  // ── Location ─────────────────────────────────────────────────────────────────
  if (payload.location) {
    try {
      await client.post(`/message/sendLocation/${instance}`, {
        number,
        latitude:  payload.location.degreesLatitude,
        longitude: payload.location.degreesLongitude,
        name:      payload.location.name || '',
        address:   payload.location.address || '',
      });
    } catch (e) {
      console.error('[EVO] sendLocation failed:', e?.response?.data || e.message);
    }
    return;
  }

  // ── Unrecognised payload — warn and skip ─────────────────────────────────────
  console.warn('[EVO] Unrecognised payload type, skipping:', Object.keys(payload).join(', '));
}

// ── Download media from an incoming message ───────────────────────────────────

async function evoDownloadMedia(client, instance, msg) {
  try {
    const key = msg?.key;
    if (!key) throw new Error('No message key');

    const { data } = await client.post(`/chat/getBase64FromMediaMessage/${instance}`, {
      message: {
        key: {
          id:          key.id,
          remoteJid:   normalizeJid(key.remoteJid),
          fromMe:      key.fromMe,
          participant: key.participant ? normalizeJid(key.participant) : undefined,
        },
        message: msg.message,
      },
      convertToMp4: false,
    });

    if (data?.base64) {
      return Buffer.from(data.base64, 'base64');
    }
    throw new Error('No base64 data returned');
  } catch (e) {
    console.error('[EVO] downloadMedia failed:', e?.response?.data || e.message);
    return null;
  }
}

// ── Create the sock-compatible adapter ───────────────────────────────────────

function createSockAdapter(instance, apiUrl, apiKey, userNumber) {
  const client = createEvoClient(apiUrl, apiKey);

  // Build Baileys-compatible user object
  const user = userNumber
    ? { id: `${userNumber}:0@s.whatsapp.net`, name: 'Firebox Bot' }
    : null;

  const sock = {
    // ── Core identity ──────────────────────────────────────────────────────────
    user,

    // ── Send messages ──────────────────────────────────────────────────────────
    async sendMessage(jid, payload, opts) {
      return evoSendMessage(client, instance, jid, payload, opts);
    },

    // ── Presence ───────────────────────────────────────────────────────────────
    async sendPresenceUpdate(type, jid) {
      try {
        await client.post(`/chat/sendPresence/${instance}`, {
          number:   normalizeJid(jid),
          presence: type, // 'composing', 'paused', 'available', 'unavailable'
        });
      } catch (_) { /* non-critical */ }
    },

    // ── Read receipts ──────────────────────────────────────────────────────────
    async readMessages(keys) {
      try {
        for (const key of (keys || [])) {
          await client.post(`/message/markMessageAsRead/${instance}`, {
            readMessages: [
              { id: key.id, fromMe: key.fromMe, remoteJid: normalizeJid(key.remoteJid) }
            ],
          }).catch(() => {});
        }
      } catch (_) {}
    },

    // ── Media download (Baileys-compatible signature) ──────────────────────────
    async downloadMediaMessage(msg) {
      return evoDownloadMedia(client, instance, msg);
    },

    // ── Update (re-upload) media — no-op in Evolution API ─────────────────────
    async updateMediaMessage(msg) {
      return msg;
    },

    // ── Profile picture ────────────────────────────────────────────────────────
    async profilePictureUrl(jid, _type) {
      try {
        const { data } = await client.get(`/chat/fetchProfilePictureUrl/${instance}`, {
          params: { number: normalizeJid(jid) },
        });
        return data?.profilePictureUrl || data?.picture || null;
      } catch (_) { return null; }
    },

    async updateProfilePicture(jid, buffer) {
      try {
        const b64 = bufferToBase64(buffer);
        await client.put(`/chat/updateProfilePicture/${instance}`, {
          number: normalizeJid(jid),
          picture: b64,
        });
      } catch (e) {
        console.error('[EVO] updateProfilePicture failed:', e?.response?.data || e.message);
      }
    },

    async removeProfilePicture(_jid) {
      // Not widely supported — no-op
    },

    // ── Check if number is on WhatsApp ─────────────────────────────────────────
    async onWhatsApp(jid) {
      try {
        const { data } = await client.get(`/chat/onWhatsApp/${instance}`, {
          params: { jid: normalizeJid(jid) },
        });
        if (Array.isArray(data)) return data;
        if (data?.exists !== undefined) return [data];
        return [];
      } catch (_) { return []; }
    },

    // ── Block / unblock ────────────────────────────────────────────────────────
    async updateBlockStatus(jid, action) {
      try {
        await client.post(`/chat/updateBlockStatus/${instance}`, {
          number: normalizeJid(jid),
          status: action, // 'block' | 'unblock'
        });
      } catch (e) {
        console.error('[EVO] updateBlockStatus failed:', e?.response?.data || e.message);
      }
    },

    async fetchBlocklist() {
      try {
        const { data } = await client.get(`/chat/fetchBlocklist/${instance}`);
        return data || [];
      } catch (_) { return []; }
    },

    // ── Privacy settings — best-effort stubs ──────────────────────────────────
    async updateGroupsAddPrivacy(_setting) {},
    async updateLastSeenPrivacy(_setting) {},
    async updateReadReceiptsPrivacy(_setting) {},
    async updateProfilePicturePrivacy(_setting) {},
    async updateProfileStatus(status) {
      try {
        await client.put(`/profile/updateProfileStatus/${instance}`, { status });
      } catch (_) {}
    },

    // ── Chat management ────────────────────────────────────────────────────────
    async chatModify(_mod, _jid) {
      // archive / mute / delete chat — not universally supported, no-op
    },

    // ── Group management ───────────────────────────────────────────────────────
    async groupMetadata(jid) {
      try {
        const { data } = await client.get(`/group/findGroupInfos/${instance}`, {
          params: { groupJid: normalizeJid(jid) },
        });
        return data;
      } catch (e) {
        console.error('[EVO] groupMetadata failed:', e?.response?.data || e.message);
        throw e;
      }
    },

    async groupParticipantsUpdate(jid, participants, action) {
      try {
        const { data } = await client.post(`/group/updateParticipant/${instance}`, {
          groupJid:     normalizeJid(jid),
          action,       // 'add' | 'remove' | 'promote' | 'demote'
          participants: participants.map(normalizeJid),
        });
        return data;
      } catch (e) {
        console.error('[EVO] groupParticipantsUpdate failed:', e?.response?.data || e.message);
        throw e;
      }
    },

    async groupUpdateSubject(jid, subject) {
      try {
        await client.put(`/group/updateGroupSubject/${instance}`, {
          groupJid: normalizeJid(jid),
          subject,
        });
      } catch (e) {
        console.error('[EVO] groupUpdateSubject failed:', e?.response?.data || e.message);
      }
    },

    async groupUpdateDescription(jid, description) {
      try {
        await client.put(`/group/updateGroupDescription/${instance}`, {
          groupJid: normalizeJid(jid),
          description,
        });
      } catch (e) {
        console.error('[EVO] groupUpdateDescription failed:', e?.response?.data || e.message);
      }
    },

    async groupSettingUpdate(jid, setting) {
      // setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked'
      try {
        await client.put(`/group/updateSetting/${instance}`, {
          groupJid: normalizeJid(jid),
          action:   setting,
        });
      } catch (e) {
        console.error('[EVO] groupSettingUpdate failed:', e?.response?.data || e.message);
      }
    },

    async groupInviteCode(jid) {
      try {
        const { data } = await client.get(`/group/inviteCode/${instance}`, {
          params: { groupJid: normalizeJid(jid) },
        });
        return data?.inviteCode || data?.code || '';
      } catch (_) { return ''; }
    },

    async groupRevokeInvite(jid) {
      try {
        const { data } = await client.post(`/group/revokeInviteCode/${instance}`, {
          groupJid: normalizeJid(jid),
        });
        return data?.inviteCode || data?.code || '';
      } catch (_) { return ''; }
    },

    async groupAcceptInvite(code) {
      try {
        const { data } = await client.post(`/group/acceptInviteCode/${instance}`, { inviteCode: code });
        return data;
      } catch (e) {
        console.error('[EVO] groupAcceptInvite failed:', e?.response?.data || e.message);
        throw e;
      }
    },

    async groupLeave(jid) {
      try {
        await client.delete(`/group/leaveGroup/${instance}`, {
          data: { groupJid: normalizeJid(jid) },
        });
      } catch (e) {
        console.error('[EVO] groupLeave failed:', e?.response?.data || e.message);
      }
    },

    async groupFetchAllParticipating() {
      try {
        const { data } = await client.get(`/group/fetchAllGroups/${instance}`, {
          params: { getParticipants: true },
        });
        // Return as a Map of jid → groupMetadata (Baileys-compatible)
        const map = {};
        for (const g of (Array.isArray(data) ? data : [])) {
          map[g.id] = g;
        }
        return map;
      } catch (_) { return {}; }
    },

    async groupRequestParticipantsList(jid) {
      try {
        const { data } = await client.get(`/group/listParticipants/${instance}`, {
          params: { groupJid: normalizeJid(jid) },
        });
        return data || [];
      } catch (_) { return []; }
    },

    async groupRequestParticipantsUpdate(jid, participants, action) {
      try {
        await client.post(`/group/manageParticipantRequest/${instance}`, {
          groupJid:     normalizeJid(jid),
          action,       // 'approve' | 'reject'
          participants: participants.map(normalizeJid),
        });
      } catch (_) {}
    },

    // ── Newsletter / channel (no-op stubs) ────────────────────────────────────
    async newsletterFollow(_jid) {},
    async getNewsletterInfo(_jid) { return null; },

    // ── Call management ────────────────────────────────────────────────────────
    async rejectCall(_callId, _jid) {
      // Evolution API doesn't expose call rejection via REST
    },

    // ── Connection control ─────────────────────────────────────────────────────
    end(_err) {
      // No-op — connection managed by Evolution API server
    },

    // ── Expose raw client for advanced use ─────────────────────────────────────
    _evoClient:   client,
    _evoInstance: instance,
    _evoApiUrl:   apiUrl,
    _evoApiKey:   apiKey,
  };

  return sock;
}

// ── Evolution API instance management ─────────────────────────────────────────

async function ensureInstance(apiUrl, apiKey, instanceName) {
  const client = createEvoClient(apiUrl, apiKey);

  // Check if instance already exists
  try {
    const { data } = await client.get(`/instance/fetchInstances`);
    const instances = Array.isArray(data) ? data : (data?.data || []);
    const existing = instances.find(i =>
      (i.instance?.instanceName || i.instanceName) === instanceName
    );
    if (existing) {
      const state = existing.instance?.connectionStatus || existing.connectionStatus || 'unknown';
      console.log(`[EVO] Instance '${instanceName}' exists — state: ${state}`);
      return { client, exists: true, state };
    }
  } catch (e) {
    console.error('[EVO] fetchInstances failed:', e?.response?.data || e.message);
  }

  // Create instance
  console.log(`[EVO] Creating instance '${instanceName}'...`);
  try {
    await client.post('/instance/create', {
      instanceName,
      qrcode:      true,
      integration: 'WHATSAPP-BAILEYS',
    });
    console.log(`[EVO] Instance '${instanceName}' created.`);
    return { client, exists: false, state: 'close' };
  } catch (e) {
    console.error('[EVO] createInstance failed:', e?.response?.data || e.message);
    return { client, exists: false, state: 'unknown' };
  }
}

async function getInstanceState(client, instanceName) {
  try {
    const { data } = await client.get(`/instance/connectionState/${instanceName}`);
    return data?.state || data?.instance?.state || 'close';
  } catch (_) { return 'unknown'; }
}

async function getInstanceNumber(client, instanceName) {
  try {
    const { data } = await client.get(`/instance/fetchInstances`);
    const instances = Array.isArray(data) ? data : (data?.data || []);
    const found = instances.find(i =>
      (i.instance?.instanceName || i.instanceName) === instanceName
    );
    if (!found) return null;
    const num = found.instance?.ownerJid || found.ownerJid;
    if (!num) return null;
    return num.split('@')[0].split(':')[0];
  } catch (_) { return null; }
}

async function setupWebhook(client, instanceName, webhookUrl) {
  try {
    await client.post(`/webhook/set/${instanceName}`, {
      webhook: {
        enabled:        true,
        url:            webhookUrl,
        webhookByEvents: false,
        webhookBase64:  false,
        events: [
          'QRCODE_UPDATED',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'MESSAGES_EDITED',
          'SEND_MESSAGE',
          'GROUPS_UPSERT',
          'GROUP_UPDATE',
          'GROUP_PARTICIPANTS_UPDATE',
          'CONNECTION_UPDATE',
          'CALL',
          'PRESENCE_UPDATE',
          'CHATS_UPSERT',
          'CHATS_UPDATE',
          'CONTACTS_UPSERT',
          'LOGOUT_INSTANCE',
          'STATUS_INSTANCE',
        ],
      },
    });
    console.log(`[EVO] Webhook set to ${webhookUrl}`);
  } catch (e) {
    console.error('[EVO] setupWebhook failed:', e?.response?.data || e.message);
  }
}

async function getQrCode(client, instanceName) {
  try {
    const { data } = await client.get(`/instance/connect/${instanceName}`);
    return data?.qrcode?.base64 || data?.base64 || data?.qrcode || null;
  } catch (_) { return null; }
}

// ── downloadContentFromMessage compatibility ──────────────────────────────────
// Returns a pseudo-stream that resolves to the buffer in one chunk.

async function downloadContentFromMessageEvo(client, instance, msgData, _type) {
  const msg = typeof msgData === 'object' && msgData.key
    ? msgData
    : { key: { id: 'unknown', remoteJid: 'unknown', fromMe: false }, message: { imageMessage: msgData } };

  const buffer = await evoDownloadMedia(client, instance, msg);
  if (!buffer) return null;

  // Return an async iterator (stream-compatible)
  return {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next() {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: buffer };
        }
      };
    }
  };
}

module.exports = {
  createSockAdapter,
  createEvoClient,
  ensureInstance,
  getInstanceState,
  getInstanceNumber,
  setupWebhook,
  getQrCode,
  evoDownloadMedia,
  downloadContentFromMessageEvo,
  normalizeJid,
  jidToNumber,
};
