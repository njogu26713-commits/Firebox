const { downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const TMP = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

async function downloadMedia(message, type) {
  const mediaType = type === 'imageMessage' ? 'image'
    : type === 'videoMessage' ? 'video'
    : type === 'stickerMessage' ? 'sticker'
    : null;
  if (!mediaType) return null;

  const media = message[type];
  const stream = await downloadContentFromMessage(media, mediaType);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function getTargetMessage(msg, quoted) {
  if (quoted) return { message: quoted.message };
  return msg;
}

async function makeSticker(ctx) {
  const { sock, from, msg, quoted } = ctx;
  const target = getTargetMessage(msg, quoted);
  const type = getContentType(target.message);

  if (!['imageMessage', 'videoMessage'].includes(type)) {
    return sock.sendMessage(from, {
      text: '❌ Send or reply to an *image* or *video* with *.sticker*\n\nExample: Send a photo then type *.sticker*'
    }, { quoted: msg });
  }

  await sock.sendMessage(from, { text: '🎨 Creating sticker, please wait...' }, { quoted: msg });

  const ext = type === 'imageMessage' ? 'jpg' : 'mp4';
  const tmpIn = path.join(TMP, `stk_in_${Date.now()}.${ext}`);
  const tmpOut = path.join(TMP, `stk_out_${Date.now()}.webp`);

  try {
    const buffer = await downloadMedia(target.message, type);
    if (!buffer) throw new Error('Could not download media');
    fs.writeFileSync(tmpIn, buffer);

    if (type === 'imageMessage') {
      await execAsync(
        `ffmpeg -i "${tmpIn}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,format=rgba" -quality 80 "${tmpOut}" -y`
      );
    } else {
      await execAsync(
        `ffmpeg -i "${tmpIn}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,fps=10,format=rgba" -loop 0 -t 00:00:08 -an -vsync 0 "${tmpOut}" -y`
      );
    }

    const stickerBuffer = fs.readFileSync(tmpOut);
    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
  } catch (err) {
    console.error('[STICKER]', err.message);
    await sock.sendMessage(from, { text: `❌ Sticker creation failed: ${err.message}` }, { quoted: msg });
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

async function stickerToImage(ctx) {
  const { sock, from, msg, quoted } = ctx;
  const target = getTargetMessage(msg, quoted);
  const type = getContentType(target.message);

  if (type !== 'stickerMessage') {
    return sock.sendMessage(from, {
      text: '❌ Please reply to a *sticker* with *.toimg*'
    }, { quoted: msg });
  }

  const tmpIn = path.join(TMP, `toimg_in_${Date.now()}.webp`);
  const tmpOut = path.join(TMP, `toimg_out_${Date.now()}.png`);

  try {
    const buffer = await downloadMedia(target.message, type);
    if (!buffer) throw new Error('Could not download sticker');
    fs.writeFileSync(tmpIn, buffer);
    await execAsync(`ffmpeg -i "${tmpIn}" "${tmpOut}" -y`);
    const imgBuffer = fs.readFileSync(tmpOut);
    await sock.sendMessage(from, { image: imgBuffer, caption: '✅ Here is your image!' }, { quoted: msg });
  } catch (err) {
    console.error('[TOIMG]', err.message);
    await sock.sendMessage(from, { text: `❌ Conversion failed: ${err.message}` }, { quoted: msg });
  } finally {
    if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  }
}

module.exports = { makeSticker, stickerToImage };
