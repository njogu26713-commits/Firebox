const { openRouterPrompt, openRouterChat, openRouterVision } = require('../openrouter');
const { downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys');
const { sendFireboxCard } = require('../card');

const PROMPT_TTL = 5 * 60 * 1000;

async function send(sock, from, msg, text, title) {
  return sendFireboxCard(sock, from, msg, { title: title || '🤖 Firebox AI', content: text });
}

function parseSuggestions(raw) {
  const marker = raw.search(/SUGGESTIONS:/i);
  if (marker === -1) return { mainReply: raw.trim(), suggestions: [] };
  const mainReply = raw.slice(0, marker).trim();
  const suggBlock = raw.slice(marker + 'SUGGESTIONS:'.length).trim();
  const suggestions = suggBlock
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(l => l.length > 2)
    .slice(0, 3);
  return { mainReply, suggestions };
}

async function sendWithPrompts(sock, from, msg, sessionState, sender, header, rawReply, cmdPrefix) {
  const { mainReply, suggestions } = parseSuggestions(rawReply);
  await sendFireboxCard(sock, from, msg, {
    title: '🤖 Firebox AI',
    content: `${header}${mainReply}`,
  });
  if (suggestions.length > 0) {
    sessionState.pendingPrompts.set(sender, {
      prompts: suggestions, cmdPrefix, type: 'command',
      expiresAt: Date.now() + PROMPT_TTL
    });
    const lines = suggestions.map((s, i) => `  *${i + 1}.* ${s}`).join('\n');
    await sendFireboxCard(sock, from, null, {
      title: '💡 Follow-up Prompts',
      content: `Reply *1*, *2* or *3* to continue:\n\n${lines}`,
      noQuote: true,
    });
  }
}

async function downloadImageBuffer(sock, message, type) {
  const mediaMsg = message[type];
  const stream = await downloadContentFromMessage(mediaMsg, 'image');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { buffer: Buffer.concat(chunks), mimeType: mediaMsg.mimetype || 'image/jpeg' };
}

async function chat(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  const { message } = msg;

  // Detect image: direct imageMessage (caption) or quoted imageMessage
  const directType = getContentType(message);
  const quotedMsg = message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const quotedType = quotedMsg ? getContentType(quotedMsg) : null;

  const hasDirectImage = directType === 'imageMessage';
  const hasQuotedImage = quotedType === 'imageMessage';

  if (hasDirectImage || hasQuotedImage) {
    const prompt = text || 'Describe this image in detail.';
    try {
      await sock.sendPresenceUpdate('composing', from);
      const { buffer, mimeType } = hasDirectImage
        ? await downloadImageBuffer(sock, message, 'imageMessage')
        : await downloadImageBuffer(sock, quotedMsg, 'imageMessage');
      const raw = await openRouterVision(buffer, mimeType, prompt);
      await send(sock, from, msg, `🔍 *Firebox AI Vision*\n\n${raw}`);
    } catch (err) {
      await send(sock, from, msg, `❌ Vision Error: ${err.message}`);
    }
    return;
  }

  if (!text) return send(sock, from, msg, '🤖 Usage: .ai <your question>\n\n_Tip: Send/reply to an image with .ai to analyze it!_');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(
      `${text}\n\nAfter answering, add exactly 3 short follow-up questions the user might ask next, formatted as:\nSUGGESTIONS:\n1. ...\n2. ...\n3. ...`
    );
    await sendWithPrompts(sock, from, msg, sessionState, sender, '🤖 *Firebox AI*\n\n', raw, '.ai ');
  } catch (err) {
    await send(sock, from, msg, `❌ AI Error: ${err.message}`);
  }
}

async function code(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '💻 Usage: .code <your coding question or code to fix>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(
      `You are an expert programmer. Answer this coding question clearly with code examples:\n\n${text}\n\nAfter answering, add exactly 3 short follow-up questions formatted as:\nSUGGESTIONS:\n1. ...\n2. ...\n3. ...`
    );
    await sendWithPrompts(sock, from, msg, sessionState, sender, '💻 *Code Assistant*\n\n', raw, '.code ');
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function story(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📖 Usage: .story <topic or theme>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const reply = await openRouterPrompt(`Write a creative short story about: ${text}. Make it engaging and about 3-4 paragraphs.`);
    await send(sock, from, msg, `📖 *Story Time*\n\n${reply}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function summarize(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📋 Usage: .summarize <long text to summarize>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const reply = await openRouterPrompt(`Summarize the following text in clear bullet points:\n\n${text}`);
    await send(sock, from, msg, `📋 *Summary*\n\n${reply}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function recipe(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🍳 Usage: .recipe <dish name>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(
      `Give me a detailed recipe for: ${text}. Include ingredients and step-by-step instructions.\n\nAfter the recipe, add 3 short follow-up questions formatted as:\nSUGGESTIONS:\n1. ...\n2. ...\n3. ...`
    );
    await sendWithPrompts(sock, from, msg, sessionState, sender, '🍳 *Recipe*\n\n', raw, '.recipe ');
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function teach(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🎓 Usage: .teach <topic you want to learn>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(
      `Explain this topic in simple, easy to understand terms with examples:\n\n${text}\n\nAfter explaining, add 3 short follow-up questions formatted as:\nSUGGESTIONS:\n1. ...\n2. ...\n3. ...`
    );
    await sendWithPrompts(sock, from, msg, sessionState, sender, '🎓 *Lesson*\n\n', raw, '.teach ');
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function analyze(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🔍 Usage: .analyze <text to analyze>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(
      `Analyze the following text. Provide sentiment, key themes, tone, and any important insights:\n\n${text}\n\nAfter your analysis, add 3 short follow-up questions formatted as:\nSUGGESTIONS:\n1. ...\n2. ...\n3. ...`
    );
    await sendWithPrompts(sock, from, msg, sessionState, sender, '🔍 *Analysis*\n\n', raw, '.analyze ');
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function translate(ctx) {
  const { sock, from, msg, args } = ctx;
  if (args.length < 2) return send(sock, from, msg, '🌐 Usage: .translate <language> <text>\nExample: .translate French Hello how are you?');
  const lang = args[0];
  const toTranslate = args.slice(1).join(' ');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const reply = await openRouterPrompt(`Translate the following text to ${lang}. Only reply with the translation, nothing else:\n\n${toTranslate}`);
    await send(sock, from, msg, `🌐 *Translation (${lang})*\n\n${reply}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

async function blackbox(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🖥️ Usage: .blackbox <coding problem>');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(
      `You are an expert software engineer. Solve this programming problem with clean, efficient code and an explanation:\n\n${text}\n\nAfter solving, add 3 short follow-up questions formatted as:\nSUGGESTIONS:\n1. ...\n2. ...\n3. ...`
    );
    await sendWithPrompts(sock, from, msg, sessionState, sender, '🖥️ *Code Solution*\n\n', raw, '.blackbox ');
  } catch (err) {
    await send(sock, from, msg, `❌ Error: ${err.message}`);
  }
}

const simiSessions = new Map();
const SIMI_SESSION_TTL = 30 * 60 * 1000;

async function simi(ctx) {
  const { sock, from, msg, text, sender } = ctx;
  if (!text) return send(sock, from, msg, '💬 Usage: .simi <message>\nExample: .simi how are you?\n\n_Simi remembers your conversation for 30 minutes._');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const sessionKey = `${from}_${sender}`;
    let session = simiSessions.get(sessionKey);
    if (!session) session = { history: [], timer: null };
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => simiSessions.delete(sessionKey), SIMI_SESSION_TTL);

    const messages = [
      { role: 'system', content: 'You are Simi, a fun, witty, and friendly WhatsApp chatbot with a great sense of humour. You are playful, sarcastic at times, but always kind. You keep your replies short (1-3 sentences max) and conversational — like texting a friend. Never be formal. Use emojis occasionally. Do not introduce yourself unless asked.' },
      ...session.history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
      { role: 'user', content: text }
    ];

    const reply = await openRouterChat(messages);
    const clean = reply.replace(/^Simi:\s*/i, '').trim();
    session.history.push({ role: 'user', text });
    session.history.push({ role: 'simi', text: clean });
    if (session.history.length > 20) session.history = session.history.slice(-20);
    simiSessions.set(sessionKey, session);
    await send(sock, from, msg, `💬 *Simi*\n\n${clean}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Simi error: ${err.message}`);
  }
}

async function dalle(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, 'Usage: `.dalle <prompt>`\nExample: `.dalle a sunset over Mount Kenya, photorealistic`', '🎨 AI Image Generate');
  await send(sock, from, msg, `Generating image for: _"${text}"_...`, '🎨 AI Image Generate');
  try {
    const axios = require('axios');
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?width=1024&height=1024&nologo=true&enhance=true&model=flux`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    await sendFireboxCard(sock, from, msg, {
      title: '🎨 AI Image Generated',
      content: `✅ Image ready!\n\n📝 *Prompt:* _"${text}"_`,
      media: { type: 'image', buffer: Buffer.from(res.data), mimetype: 'image/jpeg' },
    });
  } catch (err) { await send(sock, from, msg, `❌ Image generation failed: ${err.message}`, '🎨 AI Image Generate'); }
}

async function generate(ctx) { return dalle(ctx); }

async function deepseek(ctx) {
  const { sock, from, msg, text, sender, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🧠 *DeepSeek AI*\n\nUsage: `.deepseek <question>`\nExample: `.deepseek Explain quantum entanglement`\n\n_DeepSeek is a powerful reasoning AI._');
  try {
    await sock.sendPresenceUpdate('composing', from);
    const raw = await openRouterPrompt(text, 'deepseek/deepseek-chat-v3-0324:free');
    await sendWithPrompts(sock, from, msg, sessionState, sender, '🧠 *DeepSeek AI*\n\n', raw, '.deepseek ');
  } catch (err) { await send(sock, from, msg, `❌ DeepSeek error: ${err.message}`); }
}

async function doppleai(ctx) {
  const { sock, from, msg, text, args } = ctx;
  if (!text) return send(sock, from, msg,
    '🎭 *DoppleAI — Character Chat*\n\n' +
    'Chat with a famous personality!\n\n' +
    'Usage: `.doppleai <character> | <message>`\n' +
    'Example: `.doppleai Elon Musk | What do you think about AI?`\n\n' +
    '_Supports: Elon Musk, Albert Einstein, Rihanna, Barack Obama, and more!_'
  );
  const parts = text.split('|');
  const character = parts[0]?.trim() || 'Einstein';
  const userMsg = parts[1]?.trim() || text;
  try {
    await sock.sendPresenceUpdate('composing', from);
    const systemPrompt = `You are roleplaying as ${character}. Respond exactly how ${character} would — use their known speech patterns, views, personality, and references. Keep replies natural and engaging, like a real WhatsApp conversation. Use their real known opinions, not fabricated ones. Be concise (2-4 sentences). Do not break character.`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg }
    ];
    const reply = await openRouterChat(messages);
    await send(sock, from, msg, `🎭 *${character}:*\n\n${reply.trim()}\n\n_— ${character}_`);
  } catch (err) { await send(sock, from, msg, `❌ DoppleAI error: ${err.message}`); }
}

module.exports = { chat, code, story, summarize, recipe, teach, analyze, translate, blackbox, simi, dalle, generate, deepseek, doppleai };
