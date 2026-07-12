const ytSearch = require('yt-search');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const tlsAgent = new https.Agent({ rejectUnauthorized: false });
const YTDLP = '/home/runner/workspace/.pythonlibs/bin/yt-dlp';
const FFMPEG = (() => {
  try { return execSync('which ffmpeg', { encoding: 'utf8' }).trim(); } catch { return 'ffmpeg'; }
})();
const TMP = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const { sendFireboxCard } = require('../card');

async function send(sock, from, msg, text, title) {
  return sendFireboxCard(sock, from, msg, { title: title || '📥 Firebox Download', content: text });
}

async function sendButtons(sock, from, msg, text, buttons, sender, prefix, sessionState) {
  const nums = ['1️⃣', '2️⃣', '3️⃣'];
  const lines = buttons.map((b, i) => `  *${i + 1}.* ${b.label}`).join('\n');
  await sock.sendMessage(from, {
    text: `${text}\n\n💬 *Quick replies — send ${buttons.map((_, i) => i + 1).join(' or ')}:*\n\n${lines}`
  }, { quoted: msg });
  sessionState.pendingPrompts.set(sender, {
    type: 'cmd',
    cmdPrefix: prefix,
    prompts: buttons.map(b => b.id.startsWith(prefix) ? b.id.slice(prefix.length) : b.id),
    expiresAt: Date.now() + 5 * 60 * 1000
  });
}

// ─── YOUTUBE ─────────────────────────────────────────────────────────────────

async function downloadYoutubeAudio(youtubeUrl) {
  const outputPath = path.join(TMP, `yt_audio_${Date.now()}.%(ext)s`);
  const finalPath = outputPath.replace('%(ext)s', 'mp3');
  await execAsync(
    `"${YTDLP}" --no-playlist -x --audio-format mp3 --audio-quality 5 --ffmpeg-location "${FFMPEG}" -o "${outputPath}" "${youtubeUrl}"`,
    { timeout: 120000 }
  );
  if (!fs.existsSync(finalPath)) throw new Error('Audio file not created');
  const buf = fs.readFileSync(finalPath);
  fs.unlinkSync(finalPath);
  return buf;
}

async function downloadYoutubeVideo(youtubeUrl, durationSeconds) {
  const id = Date.now();
  const rawTemplate = path.join(TMP, `yt_raw_${id}.%(ext)s`);
  const rawPath = path.join(TMP, `yt_raw_${id}.mp4`);
  const outPath = path.join(TMP, `yt_video_${id}.mp4`);

  // Use lower quality for longer videos to stay under WhatsApp's 64MB limit
  const isLong = durationSeconds > 300;
  const res = isLong ? 360 : 480;
  const crf = isLong ? 35 : 28;

  await execAsync(
    `"${YTDLP}" --no-playlist -f "bestvideo[height<=${res}]+bestaudio/best[height<=${res}]" --merge-output-format mp4 --ffmpeg-location "${FFMPEG}" -o "${rawTemplate}" "${youtubeUrl}"`,
    { timeout: 480000 }
  );
  if (!fs.existsSync(rawPath)) throw new Error('Video download failed');

  await execAsync(
    `"${FFMPEG}" -i "${rawPath}" -c:v libx264 -preset fast -crf ${crf} -c:a aac -b:a 96k -movflags +faststart -y "${outPath}"`,
    { timeout: 480000 }
  );
  fs.unlinkSync(rawPath);

  if (!fs.existsSync(outPath)) throw new Error('Transcoding to H.264 failed');

  const stats = fs.statSync(outPath);
  if (stats.size > 64 * 1024 * 1024) {
    fs.unlinkSync(outPath);
    throw new Error('Video too large for WhatsApp (>64MB) even after compression. Try a shorter clip.');
  }

  const buf = fs.readFileSync(outPath);
  fs.unlinkSync(outPath);
  return buf;
}

async function youtubeAudio(ctx) {
  const { sock, from, msg, text, sender, prefix, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🎵 Usage: .play <song name>\nExample: .play Shape of You');

  try {
    await send(sock, from, msg, `🔍 Searching for *${text}*...`);
    const results = await ytSearch(text);
    if (!results.videos.length) return send(sock, from, msg, '❌ No results found!');

    const video = results.videos[0];
    if (video.seconds > 600) return send(sock, from, msg, '❌ Song is too long! Maximum 10 minutes.');

    await send(sock, from, msg, `🎵 *Downloading...*\n📌 ${video.title}\n⏱ ${video.timestamp}\n👁 ${Number(video.views).toLocaleString()} views`);

    const audioBuffer = await downloadYoutubeAudio(`https://www.youtube.com/watch?v=${video.videoId}`);

    await sock.sendMessage(from, {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      fileName: `${video.title}.mp3`,
      ptt: false
    }, { quoted: msg });

    await sendButtons(sock, from, msg,
      `✅ *${video.title}*\nWhat would you like next?`,
      [
        { id: `.video ${text}`,  label: '📹 Get Video' },
        { id: `.lyrics ${text}`, label: '🎤 Get Lyrics' },
      ],
      sender, prefix, sessionState
    );
  } catch (err) {
    await send(sock, from, msg, `❌ Download failed: ${err.message}`);
  }
}

async function youtubeVideo(ctx) {
  const { sock, from, msg, text, sender, prefix, sessionState } = ctx;
  if (!text) return send(sock, from, msg, '🎬 Usage: .video <video name>\nExample: .video Never Gonna Give You Up');

  try {
    await send(sock, from, msg, `🔍 Searching for *${text}*...`);
    const results = await ytSearch(text);
    if (!results.videos.length) return send(sock, from, msg, '❌ No results found!');

    const video = results.videos[0];
    if (video.seconds > 600) return send(sock, from, msg, '❌ Video too long! Maximum 10 minutes.');

    const waitNote = video.seconds > 300
      ? '_Long video — this may take 3–5 minutes, please wait... ⏳_'
      : '_This may take up to a minute..._';
    await send(sock, from, msg, `📹 *Downloading...*\n📌 ${video.title}\n⏱ ${video.timestamp}\n${waitNote}`);

    const videoBuffer = await downloadYoutubeVideo(`https://www.youtube.com/watch?v=${video.videoId}`, video.seconds);

    await sock.sendMessage(from, {
      video: videoBuffer,
      caption: `🎬 *${video.title}*`,
      mimetype: 'video/mp4'
    }, { quoted: msg });

    await sendButtons(sock, from, msg,
      `✅ *${video.title}*\nWhat would you like next?`,
      [
        { id: `.play ${text}`,   label: '🎵 Get Audio' },
        { id: `.lyrics ${text}`, label: '🎤 Get Lyrics' },
      ],
      sender, prefix, sessionState
    );
  } catch (err) {
    await send(sock, from, msg, `❌ Download failed: ${err.message}`);
  }
}

// ─── TIKTOK ──────────────────────────────────────────────────────────────────

async function tiktok(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎵 Usage: .tiktok <TikTok URL>');

  try {
    await send(sock, from, msg, '📥 Downloading TikTok...');
    const apiUrl = `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(text)}`;
    const res = await axios.get(apiUrl, { timeout: 20000, httpsAgent: tlsAgent });
    const data = res.data;

    if (!data?.video?.noWatermark && !data?.video?.downloadAddr) throw new Error('Could not extract video');

    const videoUrl = data.video.noWatermark || data.video.downloadAddr;
    const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000, headers: { 'User-Agent': 'Mozilla/5.0' }, httpsAgent: tlsAgent });

    await sock.sendMessage(from, {
      video: Buffer.from(videoRes.data),
      caption: `🎵 *${data.title || 'TikTok Video'}*\n👤 @${data.author?.uniqueId || 'Unknown'}`,
      mimetype: 'video/mp4'
    }, { quoted: msg });
  } catch (err) {
    await send(sock, from, msg, `❌ TikTok download failed: ${err.message}`);
  }
}

async function tiktokaudio(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎵 Usage: .tiktokaudio <TikTok URL>');
  try {
    await send(sock, from, msg, '📥 Downloading TikTok audio...');
    const res = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(text)}`, { timeout: 20000, httpsAgent: tlsAgent });
    const audioUrl = res.data?.music?.play_url;
    if (!audioUrl) throw new Error('No audio found');

    const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 30000, httpsAgent: tlsAgent });
    await sock.sendMessage(from, {
      audio: Buffer.from(audioRes.data),
      mimetype: 'audio/mpeg',
      fileName: `${res.data?.music?.title || 'tiktok'}.mp3`,
      ptt: false
    }, { quoted: msg });
  } catch (err) {
    await send(sock, from, msg, `❌ Failed: ${err.message}`);
  }
}

// ─── INSTAGRAM ───────────────────────────────────────────────────────────────

async function instagram(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📸 Usage: .instagram <post/reel URL>');
  if (!text.includes('instagram.com')) return send(sock, from, msg, '❌ Please provide a valid Instagram URL!');

  try {
    await send(sock, from, msg, '📥 Downloading Instagram media...');
    const outputTemplate = path.join(TMP, `ig_${Date.now()}.%(ext)s`);
    const outputMp4 = outputTemplate.replace('%(ext)s', 'mp4');
    const outputJpg = outputTemplate.replace('%(ext)s', 'jpg');

    await execAsync(
      `"${YTDLP}" --no-playlist -o "${outputTemplate}" "${text}"`,
      { timeout: 60000 }
    );

    if (fs.existsSync(outputMp4)) {
      const buf = fs.readFileSync(outputMp4);
      await sock.sendMessage(from, { video: buf, caption: '📸 Instagram media', mimetype: 'video/mp4' }, { quoted: msg });
      fs.unlinkSync(outputMp4);
    } else if (fs.existsSync(outputJpg)) {
      const buf = fs.readFileSync(outputJpg);
      await sock.sendMessage(from, { image: buf, caption: '📸 Instagram media' }, { quoted: msg });
      fs.unlinkSync(outputJpg);
    } else {
      throw new Error('Download failed — post may require login or is private');
    }
  } catch (err) {
    await send(sock, from, msg, `❌ Instagram download failed. Make sure the post is public.\nError: ${err.message}`);
  }
}

// ─── FACEBOOK ────────────────────────────────────────────────────────────────

async function facebook(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📘 Usage: .facebook <video URL>');
  if (!text.includes('facebook.com') && !text.includes('fb.watch')) return send(sock, from, msg, '❌ Please provide a valid Facebook URL!');

  try {
    await send(sock, from, msg, '📥 Downloading Facebook video...');
    const outputPath = path.join(TMP, `fb_${Date.now()}.mp4`);
    await execAsync(`${YTDLP} --no-playlist -f "best[ext=mp4]/best" -o "${outputPath}" "${text}"`, { timeout: 90000 });

    if (!fs.existsSync(outputPath)) throw new Error('Download failed');
    const buf = fs.readFileSync(outputPath);
    const stats = fs.statSync(outputPath);
    if (stats.size > 60 * 1024 * 1024) {
      fs.unlinkSync(outputPath);
      return send(sock, from, msg, '❌ Video is too large (max 60MB)!');
    }
    await sock.sendMessage(from, { video: buf, caption: '📘 Facebook Video', mimetype: 'video/mp4' }, { quoted: msg });
    fs.unlinkSync(outputPath);
  } catch (err) {
    await send(sock, from, msg, `❌ Facebook download failed: ${err.message}`);
  }
}

// ─── TWITTER / X ─────────────────────────────────────────────────────────────

async function twitter(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🐦 Usage: .twitter <tweet URL>');
  if (!text.includes('twitter.com') && !text.includes('x.com') && !text.includes('t.co')) {
    return send(sock, from, msg, '❌ Please provide a valid Twitter/X URL!');
  }

  try {
    await send(sock, from, msg, '📥 Downloading Twitter/X video...');
    const outputPath = path.join(TMP, `tw_${Date.now()}.mp4`);
    await execAsync(`${YTDLP} --no-playlist -f "best[ext=mp4]/best" -o "${outputPath}" "${text}"`, { timeout: 60000 });

    if (!fs.existsSync(outputPath)) throw new Error('Download failed');
    const buf = fs.readFileSync(outputPath);
    await sock.sendMessage(from, { video: buf, caption: '🐦 Twitter/X Video', mimetype: 'video/mp4' }, { quoted: msg });
    fs.unlinkSync(outputPath);
  } catch (err) {
    await send(sock, from, msg, `❌ Twitter download failed: ${err.message}`);
  }
}

// ─── PINTEREST ───────────────────────────────────────────────────────────────

async function pinterest(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📌 Usage: .pin <Pinterest URL>');
  try {
    await send(sock, from, msg, '📥 Downloading Pinterest media...');
    const outputPath = path.join(TMP, `pin_${Date.now()}.jpg`);
    await execAsync(`${YTDLP} --no-playlist -o "${outputPath}" "${text}"`, { timeout: 30000 });
    if (!fs.existsSync(outputPath)) throw new Error('Download failed');
    const buf = fs.readFileSync(outputPath);
    await sock.sendMessage(from, { image: buf, caption: '📌 Pinterest' }, { quoted: msg });
    fs.unlinkSync(outputPath);
  } catch (err) {
    await send(sock, from, msg, `❌ Pinterest download failed: ${err.message}`);
  }
}

// ─── SAVE STATUS ─────────────────────────────────────────────────────────────

async function savestatus(ctx) {
  const { sock, from, msg } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return send(sock, from, msg, '💾 Reply to a status/story with .savestatus to save it!');

  try {
    if (quoted.imageMessage) {
      const stream = await sock.downloadMediaMessage({ message: quoted });
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      await sock.sendMessage(from, {
        image: buf,
        caption: `💾 Status saved!`
      }, { quoted: msg });
    } else if (quoted.videoMessage) {
      const stream = await sock.downloadMediaMessage({ message: quoted });
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      await sock.sendMessage(from, {
        video: buf,
        caption: `💾 Status saved!`,
        mimetype: 'video/mp4'
      }, { quoted: msg });
    } else if (quoted.audioMessage) {
      const stream = await sock.downloadMediaMessage({ message: quoted });
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      await sock.sendMessage(from, {
        audio: buf,
        mimetype: 'audio/mpeg',
        ptt: false
      }, { quoted: msg });
    } else {
      await send(sock, from, msg, '❌ Only image, video, and audio statuses can be saved!');
    }
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to save: ${err.message}`);
  }
}

// ─── SONG (alias for play) ───────────────────────────────────────────────────

async function song(ctx) { return youtubeAudio(ctx); }

// ─── IMAGE SEARCH ────────────────────────────────────────────────────────────

async function image(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🖼️ *Image Search*\n\nUsage: `.image <search term>`\nExample: `.image Nairobi skyline`');
  await send(sock, from, msg, `🔍 Searching images for *${text}*...`);
  try {
    const q = encodeURIComponent(text);
    const url = `https://image.pollinations.ai/prompt/${q}?width=1024&height=768&nologo=true&enhance=true`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 });
    await sock.sendMessage(from, { image: Buffer.from(res.data), caption: `🖼️ *${text}*`, mimetype: 'image/jpeg' }, { quoted: msg });
  } catch (err) { await send(sock, from, msg, `❌ Image search failed: ${err.message}`); }
}

// ─── APK DOWNLOAD ────────────────────────────────────────────────────────────

async function apk(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📱 *APK Downloader*\n\nUsage: `.apk <app name or package>`\nExample: `.apk WhatsApp`\n\n_Searches APKPure for the latest APK._');
  await send(sock, from, msg, `📱 Searching APK for *${text}*...`);
  try {
    const res = await axios.get(`https://apkpure.com/search?q=${encodeURIComponent(text)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000
    });
    const html = res.data;
    const match = html.match(/href="(\/[^"]+\/[^"]+)"[^>]*>[\s\S]*?<p class="[^"]*">\s*([^<]+)<\/p>/);
    const nameMatch = html.match(/<p class="search-title[^"]*">([^<]+)<\/p>/);
    if (nameMatch) {
      const appName = nameMatch[1].trim();
      await send(sock, from, msg,
        `📱 *APK Found: ${appName}*\n\n` +
        `🔗 Download: https://apkpure.com/search?q=${encodeURIComponent(text)}\n\n` +
        `_Visit the link to download the latest APK._`
      );
    } else {
      await send(sock, from, msg,
        `📱 *APK Search: ${text}*\n\n` +
        `🔗 Search results: https://apkpure.com/search?q=${encodeURIComponent(text)}\n\n` +
        `_Visit the link to find and download the APK._`
      );
    }
  } catch (err) {
    await send(sock, from, msg,
      `📱 *APK: ${text}*\n\n` +
      `🔗 https://apkpure.com/search?q=${encodeURIComponent(text)}\n` +
      `🔗 https://apkmirror.com/?post_type=app_release&searchtype=app&s=${encodeURIComponent(text)}\n\n` +
      `_Click the links to download the APK manually._`
    );
  }
}

// ─── MEDIAFIRE DOWNLOAD ──────────────────────────────────────────────────────

async function mediafire(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text || !text.includes('mediafire.com')) return send(sock, from, msg, '📁 *MediaFire Downloader*\n\nUsage: `.mediafire <mediafire link>`\nExample: `.mediafire https://www.mediafire.com/file/...`');
  await send(sock, from, msg, '📁 Processing MediaFire link...');
  try {
    const res = await axios.get(text, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
    const html = res.data;
    const dlMatch = html.match(/href="(https:\/\/download[^"]+mediafire\.com[^"]+)"/);
    const nameMatch = html.match(/class="filename[^"]*">([^<]+)<\/div>/);
    const sizeMatch = html.match(/class="details[^"]*">.*?(\d+[\.\d]+ (?:MB|KB|GB))/s);
    if (dlMatch) {
      const dlUrl = dlMatch[1];
      const name = nameMatch?.[1]?.trim() || 'file';
      const size = sizeMatch?.[1] || 'unknown size';
      await send(sock, from, msg,
        `📁 *MediaFire Download*\n\n` +
        `📄 *File:* ${name}\n` +
        `💾 *Size:* ${size}\n` +
        `🔗 *Direct Link:*\n${dlUrl}\n\n` +
        `_Click the link to download directly._`
      );
    } else {
      await send(sock, from, msg, `❌ Could not extract download link. The file may be private or deleted.\n\n🔗 ${text}`);
    }
  } catch (err) { await send(sock, from, msg, `❌ Failed to process MediaFire link: ${err.message}`); }
}

// ─── GDRIVE DOWNLOAD ────────────────────────────────────────────────────────

async function gdrive(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📂 *Google Drive Downloader*\n\nUsage: `.gdrive <drive share link>`\nExample: `.gdrive https://drive.google.com/file/d/...`\n\n_File must be set to "Anyone with the link"._');
  const match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return send(sock, from, msg, '❌ Invalid Google Drive link. Make sure it looks like:\nhttps://drive.google.com/file/d/FILE_ID/view');
  const fileId = match[1];
  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  await send(sock, from, msg,
    `📂 *Google Drive File*\n\n` +
    `🆔 *File ID:* \`${fileId}\`\n` +
    `🔗 *Direct Download Link:*\n${directUrl}\n\n` +
    `⚠️ _For files > 100MB, Google may show a warning page — click "Download anyway"._`
  );
}

// ─── GIT CLONE ──────────────────────────────────────────────────────────────

async function gitclone(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔗 *Git Clone*\n\nUsage: `.gitclone <github repo url>`\nExample: `.gitclone https://github.com/user/repo`\n\nGets repository info and clone command.');
  let url = text.trim();
  if (!url.startsWith('http')) url = `https://github.com/${url}`;
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
  if (!match) return send(sock, from, msg, '❌ Invalid GitHub URL. Example: https://github.com/user/reponame');
  const [, owner, repo] = match;
  await send(sock, from, msg, `🔍 Fetching repo info for *${owner}/${repo}*...`);
  try {
    const res = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { 'User-Agent': 'Firebox-Bot', Accept: 'application/vnd.github.v3+json' },
      timeout: 10000
    });
    const d = res.data;
    const reply =
      `🔗 *${d.full_name}*\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `📝 ${d.description || 'No description'}\n\n` +
      `⭐ *Stars:* ${d.stargazers_count?.toLocaleString()}\n` +
      `🍴 *Forks:* ${d.forks_count?.toLocaleString()}\n` +
      `👁️ *Watchers:* ${d.watchers_count?.toLocaleString()}\n` +
      `🌿 *Default Branch:* ${d.default_branch}\n` +
      `💻 *Language:* ${d.language || 'N/A'}\n` +
      `📦 *Size:* ${(d.size / 1024).toFixed(1)} MB\n\n` +
      `*Clone Commands:*\n` +
      `\`git clone ${d.clone_url}\`\n` +
      `\`git clone ${d.ssh_url}\`\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`;
    await send(sock, from, msg, reply);
  } catch (err) {
    await send(sock, from, msg, `❌ Repo not found or private: *${owner}/${repo}*\n\nClone command:\n\`git clone https://github.com/${owner}/${repo}.git\``);
  }
}

// ─── ITUNES SEARCH ──────────────────────────────────────────────────────────

async function itunes(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎵 *iTunes Search*\n\nUsage: `.itunes <song/artist>`\nExample: `.itunes Blinding Lights The Weeknd`');
  await send(sock, from, msg, `🎵 Searching iTunes for *${text}*...`);
  try {
    const res = await axios.get('https://itunes.apple.com/search', {
      params: { term: text, media: 'music', entity: 'song', limit: 5 }, timeout: 12000
    });
    const results = res.data.results;
    if (!results?.length) return send(sock, from, msg, `❌ No results found for "*${text}*"`);
    const lines = results.map((s, i) => {
      const dur = s.trackTimeMillis ? `${Math.floor(s.trackTimeMillis / 60000)}:${String(Math.floor((s.trackTimeMillis % 60000) / 1000)).padStart(2, '0')}` : 'N/A';
      return `*${i + 1}.* 🎵 ${s.trackName}\n   👤 ${s.artistName} | 💿 ${s.collectionName || 'N/A'} | ⏱ ${dur}`;
    }).join('\n\n');
    await send(sock, from, msg, `🎵 *iTunes: "${text}"*\n\n${lines}\n\n_Use .song or .lyrics for more options_`);
  } catch (err) { await send(sock, from, msg, `❌ iTunes search failed: ${err.message}`); }
}

// ─── TELEGRAM STICKER ───────────────────────────────────────────────────────

async function telesticker(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text || !text.includes('t.me/addstickers/')) {
    return send(sock, from, msg,
      '📦 *Telegram Sticker Pack*\n\n' +
      'Usage: `.telesticker <t.me/addstickers/pack-name>`\n' +
      'Example: `.telesticker https://t.me/addstickers/HotCherry`\n\n' +
      '_Gets info about a Telegram sticker pack._'
    );
  }
  const packName = text.split('/addstickers/').pop().split('?')[0].trim();
  await send(sock, from, msg, `📦 Fetching Telegram sticker pack: *${packName}*...`);
  try {
    const res = await axios.get(`https://t.me/addstickers/${packName}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000
    });
    const html = res.data;
    const titleMatch = html.match(/<div class="tgme_page_title[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/);
    const descMatch = html.match(/<div class="tgme_page_description[^"]*">([^<]+)<\/div>/);
    const title = titleMatch?.[1]?.trim() || packName;
    const desc = descMatch?.[1]?.trim() || '';
    await send(sock, from, msg,
      `📦 *Telegram Sticker Pack*\n\n` +
      `🏷️ *Name:* ${title}\n` +
      `${desc ? `📝 *Info:* ${desc}\n` : ''}` +
      `🔗 *Link:* https://t.me/addstickers/${packName}\n\n` +
      `_Open the link in Telegram to add this sticker pack._`
    );
  } catch (err) {
    await send(sock, from, msg, `📦 *Sticker Pack:* ${packName}\n🔗 https://t.me/addstickers/${packName}\n\n_Open this link in Telegram to add._`);
  }
}

// ─── VIDEO AS DOCUMENT ──────────────────────────────────────────────────────

async function videodoc(ctx) {
  const { sock, from, msg, text } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.videoMessage) {
    return send(sock, from, msg,
      '📄 *Video as Document*\n\n' +
      'Reply to a video message with `.videodoc`\n\n' +
      '_Sends the video as a downloadable document file (no compression)._'
    );
  }
  await send(sock, from, msg, '📄 Converting video to document...');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = {
      key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant },
      message: quoted
    };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    const filename = `video_${Date.now()}.mp4`;
    await sock.sendMessage(from, {
      document: buf,
      mimetype: 'video/mp4',
      fileName: filename,
      caption: '📄 *Video sent as document*\n_No WhatsApp compression applied._'
    }, { quoted: msg });
  } catch (err) { await send(sock, from, msg, `❌ Failed: ${err.message}`); }
}

// ─── GENERIC DOWNLOAD ───────────────────────────────────────────────────────

async function download(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg,
    '⬇️ *Universal Downloader*\n\n' +
    'Usage: `.download <url>`\n\n' +
    '*Supported platforms:*\n' +
    '• YouTube → `.song` or `.video`\n' +
    '• TikTok → `.tiktok`\n' +
    '• Instagram → `.instagram`\n' +
    '• Facebook → `.facebook`\n' +
    '• Twitter/X → `.twitter`\n' +
    '• Pinterest → `.pin`\n' +
    '• MediaFire → `.mediafire <link>`\n' +
    '• Google Drive → `.gdrive <link>`\n' +
    '• GitHub → `.gitclone <link>`'
  );
  const lower = text.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return youtubeAudio(ctx);
  if (lower.includes('tiktok.com')) return tiktok(ctx);
  if (lower.includes('instagram.com')) return instagram(ctx);
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return facebook(ctx);
  if (lower.includes('twitter.com') || lower.includes('x.com')) return twitter(ctx);
  if (lower.includes('pinterest.com') || lower.includes('pin.it')) return pinterest(ctx);
  if (lower.includes('mediafire.com')) return mediafire(ctx);
  if (lower.includes('drive.google.com')) return gdrive(ctx);
  if (lower.includes('github.com')) return gitclone(ctx);
  await send(sock, from, msg, `❌ Unsupported URL: ${text}\n\nFor help, use .download without a link to see supported platforms.`);
}

// ─── WALLPAPER ──────────────────────────────────────────────────────────────

async function wallpaper(ctx) {
  const { sock, from, msg, text } = ctx;
  const query = text || 'nature 4K wallpaper beautiful';
  await send(sock, from, msg, `🖼️ Fetching wallpaper: *${query}*...`);
  try {
    const prompt = `${query}, 4K wallpaper, ultra high resolution, stunning, beautiful, wide format`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1920&height=1080&nologo=true&enhance=true`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 });
    await sock.sendMessage(from, { image: Buffer.from(res.data), caption: `🖼️ *Wallpaper: ${query}*`, mimetype: 'image/jpeg' }, { quoted: msg });
  } catch (err) { await send(sock, from, msg, `❌ Wallpaper fetch failed: ${err.message}`); }
}

// ─── REMINI (IMAGE ENHANCE) ──────────────────────────────────────────────────

async function remini(ctx) {
  const { sock, from, msg } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.imageMessage) return send(sock, from, msg, '✨ *Remini — Image Enhancer*\n\nReply to an image with `.remini` to enhance its quality.\n\n_Works best on blurry or low-resolution photos._');
  await send(sock, from, msg, '✨ Enhancing image quality...');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = {
      key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant },
      message: quoted
    };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const imgBuf = Buffer.from(chunks);
    const base64 = imgBuf.toString('base64');
    const mimeType = quoted.imageMessage?.mimetype || 'image/jpeg';
    const res = await axios.post('https://api.deepai.org/api/torch-srgan', {
      image: `data:${mimeType};base64,${base64}`
    }, {
      headers: { 'api-key': process.env.DEEPAI_KEY || 'quickstart-QUdJIGlzIGF3ZXNvbWU' },
      timeout: 60000
    });
    const outputUrl = res.data?.output_url;
    if (!outputUrl) throw new Error('Enhancement failed');
    const imgRes = await axios.get(outputUrl, { responseType: 'arraybuffer', timeout: 30000 });
    await sock.sendMessage(from, {
      image: Buffer.from(imgRes.data),
      caption: '✨ *Enhanced Image (Remini)*\n_AI-powered quality enhancement applied._',
      mimetype: 'image/jpeg'
    }, { quoted: msg });
  } catch (err) {
    await send(sock, from, msg, `❌ Enhancement failed: ${err.message}\n\n_Note: Add DEEPAI_KEY to Config Vars for better results._`);
  }
}

module.exports = {
  youtubeAudio, youtubeVideo,
  tiktok, tiktokaudio,
  instagram, facebook, twitter, pinterest,
  savestatus, song,
  image, apk, mediafire, gdrive, gitclone, itunes, telesticker, videodoc, download, wallpaper, remini
};
