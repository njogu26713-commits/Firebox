const { execSync } = require('child_process');
const { promisify } = require('util');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const execAsync = promisify(exec);

const FFMPEG = (() => {
  try { return execSync('which ffmpeg', { encoding: 'utf8' }).trim(); } catch { return 'ffmpeg'; }
})();
const TMP = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

async function send(sock, from, msg, text) {
  const lines = text.split('\n');
  if (/\*[^*\n]+\*/.test(lines[0])) lines[0] = '> ' + lines[0];
  await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: msg });
}

async function downloadQuoted(sock, msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return null;
  const qm = ctx.quotedMessage;
  const type = Object.keys(qm).find(t => ['audioMessage', 'videoMessage', 'documentMessage'].includes(t));
  if (!type) return null;
  const fakeMsg = {
    key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant },
    message: qm
  };
  try {
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
  } catch { return null; }
}

async function applyEffect(sock, msg, from, inputBuf, filter) {
  const id = Date.now();
  const inp = path.join(TMP, `af_in_${id}`);
  const out = path.join(TMP, `af_out_${id}.mp3`);
  fs.writeFileSync(inp, inputBuf);
  try {
    await execAsync(`"${FFMPEG}" -i "${inp}" ${filter} -q:a 2 -y "${out}"`, { timeout: 90000 });
    if (!fs.existsSync(out)) throw new Error('Output not created');
    const buf = fs.readFileSync(out);
    await sock.sendMessage(from, { audio: buf, mimetype: 'audio/mpeg', ptt: false }, { quoted: msg });
  } finally {
    if (fs.existsSync(inp)) fs.unlinkSync(inp);
    if (fs.existsSync(out)) try { fs.unlinkSync(out); } catch {}
  }
}

async function bass(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '🎵 *Bass Boost*\n\nReply to an audio/video message with `.bass`\n\nBoosts low frequencies for a punchy bass sound.');
  await send(sock, from, msg, '🎵 Applying bass boost...');
  try { await applyEffect(sock, msg, from, buf, '-af "bass=g=20,volume=1.5"'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

async function blown(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '💥 *Blown Speaker*\n\nReply to an audio/video message with `.blown`\n\nMakes audio sound like a blown-out speaker.');
  await send(sock, from, msg, '💥 Applying blown speaker effect...');
  try { await applyEffect(sock, msg, from, buf, '-af "acrusher=level_in=4:level_out=1:bits=8:mode=log:aa=1"'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

async function deep(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '🎤 *Deep Voice*\n\nReply to an audio/voice message with `.deep`\n\nMakes the voice sound deeper and slower.');
  await send(sock, from, msg, '🎤 Applying deep voice effect...');
  try { await applyEffect(sock, msg, from, buf, '-af "asetrate=44100*0.75,aresample=44100,atempo=1.25"'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

async function earrape(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '📢 *Earrape*\n\nReply to an audio/video message with `.earrape`\n\n⚠️ Warning: Extremely loud!');
  await send(sock, from, msg, '📢 Applying earrape effect... 🔊');
  try { await applyEffect(sock, msg, from, buf, '-af "acrusher=level_in=8:level_out=1:bits=8:mode=log,volume=15"'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

async function reverseAudio(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return null;
  await send(sock, from, msg, '🔄 Reversing audio...');
  try { await applyEffect(sock, msg, from, buf, '-af "areverse"'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
  return true;
}

async function robot(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '🤖 *Robot Voice*\n\nReply to an audio/voice message with `.robot`\n\nGives the voice a robotic metallic sound.');
  await send(sock, from, msg, '🤖 Applying robot voice effect...');
  try { await applyEffect(sock, msg, from, buf, '-af "aeval=\'0.5*val(0)+0.5*sin(2*PI*440/44100*n)\':c=same"'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

async function tomp3(ctx) {
  const { sock, from, msg } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '🎵 *Convert to MP3*\n\nReply to any audio/video message with `.tomp3`\n\nConverts and sends it back as an MP3 file.');
  await send(sock, from, msg, '🎵 Converting to MP3...');
  try { await applyEffect(sock, msg, from, buf, '-vn -acodec libmp3lame -ab 192k'); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

async function toptt(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔊 *Text to Speech*\n\nUsage: `.toptt <text>`\nExample: `.toptt Hello world, how are you?`\n\n_Converts text to a voice note._');
  await send(sock, from, msg, '🔊 Generating speech...');
  try {
    const encoded = encodeURIComponent(text.slice(0, 200));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en&client=tw-ob`;
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    await sock.sendMessage(from, { audio: Buffer.from(res.data), mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
  } catch (e) { await send(sock, from, msg, `❌ TTS failed: ${e.message}`); }
}

async function volaudio(ctx) {
  const { sock, from, msg, args } = ctx;
  const buf = await downloadQuoted(sock, msg);
  if (!buf) return send(sock, from, msg, '🔊 *Volume Boost*\n\nReply to an audio/video message with `.volaudio [level]`\nExample: `.volaudio 3` (1-10x, default 2x)');
  const vol = Math.min(Math.max(parseFloat(args[0]) || 2, 0.1), 10);
  await send(sock, from, msg, `🔊 Boosting volume by *${vol}x*...`);
  try { await applyEffect(sock, msg, from, buf, `-af "volume=${vol}"`); }
  catch (e) { await send(sock, from, msg, `❌ Failed: ${e.message}`); }
}

module.exports = { bass, blown, deep, earrape, reverseAudio, robot, tomp3, toptt, volaudio };
