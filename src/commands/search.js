const axios = require('axios');
const ytSearch = require('yt-search');

async function send(sock, from, msg, text) {
  const lines = text.split('\n');
  if (/\*[^*\n]+\*/.test(lines[0])) lines[0] = '> ' + lines[0];
  await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: msg });
}

async function weather(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🌤️ Usage: .weather <city>\nExample: .weather Nairobi');
  try {
    await send(sock, from, msg, `🌤️ Fetching weather for *${text}*...`);
    const res = await axios.get(`https://wttr.in/${encodeURIComponent(text)}?format=j1`, { timeout: 10000 });
    const d = res.data;
    const current = d.current_condition[0];
    const area = d.nearest_area[0];
    const areaName = area.areaName[0].value;
    const country = area.country[0].value;
    const temp = current.temp_C;
    const feels = current.FeelsLikeC;
    const humidity = current.humidity;
    const wind = current.windspeedKmph;
    const desc = current.weatherDesc[0].value;
    const uv = current.uvIndex;

    const reply = `
🌍 *Weather — ${areaName}, ${country}*
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
🌡️ *Temperature:* ${temp}°C
🤔 *Feels Like:* ${feels}°C
☁️ *Condition:* ${desc}
💧 *Humidity:* ${humidity}%
💨 *Wind Speed:* ${wind} km/h
☀️ *UV Index:* ${uv}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`.trim();

    await send(sock, from, msg, reply);
  } catch (err) {
    await send(sock, from, msg, `❌ Could not fetch weather. Check the city name and try again.`);
  }
}

async function lyrics(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎵 Usage: .lyrics <song name>\nExample: .lyrics Shape of You Ed Sheeran');
  try {
    await send(sock, from, msg, `🎵 Searching lyrics for *${text}*...`);

    const searchRes = await axios.get(`https://lrclib.net/api/search`, {
      params: { q: text },
      timeout: 12000
    });

    const results = searchRes.data;
    if (!results || results.length === 0) {
      return send(sock, from, msg, `❌ Lyrics not found for "*${text}*". Try including the artist name, e.g. _Shape of You Ed Sheeran_`);
    }

    const best = results.find(r => r.plainLyrics) || results[0];
    const lyricsText = best.plainLyrics;

    if (!lyricsText) {
      return send(sock, from, msg, `❌ Lyrics not found for "*${text}*".`);
    }

    const songTitle = best.trackName || text;
    const artistName = best.artistName || '';
    const duration = best.duration ? `${Math.floor(best.duration / 60)}:${String(Math.floor(best.duration % 60)).padStart(2, '0')}` : '';

    const header = `🎵 *${songTitle}*${artistName ? ` — ${artistName}` : ''}${duration ? ` (${duration})` : ''}\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n`;
    const trimmed = lyricsText.slice(0, 3500 - header.length);
    const truncated = lyricsText.length > (3500 - header.length);

    await send(sock, from, msg, `${header}${trimmed}${truncated ? '\n\n_...lyrics truncated_' : ''}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Lyrics not found for "*${text}*". Try: _artist name + song title_`);
  }
}

async function define(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📖 Usage: .define <word>\nExample: .define serendipity');
  try {
    const word = text.split(' ')[0].toLowerCase();
    const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeout: 10000 });
    const entry = res.data[0];
    const phonetic = entry.phonetic || entry.phonetics?.[0]?.text || '';
    const meanings = entry.meanings.slice(0, 2).map(m => {
      const defs = m.definitions.slice(0, 2).map((d, i) => `${i + 1}. ${d.definition}${d.example ? `\n   _"${d.example}"_` : ''}`).join('\n');
      return `*${m.partOfSpeech}*\n${defs}`;
    }).join('\n\n');

    const synonyms = entry.meanings[0]?.definitions[0]?.synonyms?.slice(0, 5).join(', ') || 'None';

    const reply = `
📖 *${word}* ${phonetic}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
${meanings}

🔗 *Synonyms:* ${synonyms}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`.trim();

    await send(sock, from, msg, reply);
  } catch (err) {
    await send(sock, from, msg, `❌ Word "*${text}*" not found in the dictionary.`);
  }
}

async function yts(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔍 Usage: .yts <search query>\nExample: .yts Bohemian Rhapsody');
  try {
    await send(sock, from, msg, `🔍 Searching YouTube for *${text}*...`);
    const results = await ytSearch(text);
    const videos = results.videos.slice(0, 5);
    if (!videos.length) return send(sock, from, msg, '❌ No results found!');

    const list = videos.map((v, i) =>
      `${i + 1}. 🎬 *${v.title}*\n   ⏱ ${v.timestamp} | 👁 ${Number(v.views).toLocaleString()} views\n   🔗 https://youtu.be/${v.videoId}`
    ).join('\n\n');

    await send(sock, from, msg, `🔍 *YouTube Results for "${text}"*\n\n${list}\n\n_Use .play or .video to download_`);
  } catch (err) {
    await send(sock, from, msg, `❌ Search failed: ${err.message}`);
  }
}

async function imdb(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎬 Usage: .imdb <movie or show name>');
  try {
    await send(sock, from, msg, `🎬 Searching IMDB for *${text}*...`);
    const res = await axios.get(`https://www.omdbapi.com/?t=${encodeURIComponent(text)}&apikey=trilogy`, { timeout: 10000 });
    const d = res.data;
    if (d.Response === 'False') return send(sock, from, msg, `❌ Movie/Show "*${text}*" not found.`);

    const reply = `
🎬 *${d.Title}* (${d.Year})
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
📋 *Type:* ${d.Type}
🎭 *Genre:* ${d.Genre}
⭐ *Rating:* ${d.imdbRating}/10 (${d.imdbVotes} votes)
⏱️ *Runtime:* ${d.Runtime}
🌍 *Language:* ${d.Language}
🎬 *Director:* ${d.Director}
🌟 *Cast:* ${d.Actors}

📝 *Plot:*
${d.Plot}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`.trim();

    await send(sock, from, msg, reply);
  } catch (err) {
    await send(sock, from, msg, `❌ IMDB search failed.`);
  }
}

async function songinfo(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🎵 Usage: .songinfo <song name>\nExample: .songinfo Blinding Lights The Weeknd');
  try {
    await send(sock, from, msg, `🔍 Searching song info for *${text}*...`);

    const res = await axios.get('https://itunes.apple.com/search', {
      params: { term: text, media: 'music', entity: 'song', limit: 5 },
      timeout: 12000
    });

    const results = res.data.results;
    if (!results || results.length === 0) {
      return send(sock, from, msg, `❌ No song found for "*${text}*". Try including the artist name.`);
    }

    const song = results[0];
    const title      = song.trackName || 'Unknown';
    const artist     = song.artistName || 'Unknown';
    const album      = song.collectionName || 'Unknown';
    const genre      = song.primaryGenreName || 'Unknown';
    const released   = song.releaseDate ? new Date(song.releaseDate).getFullYear() : 'Unknown';
    const duration   = song.trackTimeMillis
      ? `${Math.floor(song.trackTimeMillis / 60000)}:${String(Math.floor((song.trackTimeMillis % 60000) / 1000)).padStart(2, '0')}`
      : 'Unknown';
    const artworkUrl = song.artworkUrl100
      ? song.artworkUrl100.replace('100x100bb', '600x600bb')
      : null;

    const caption =
`🎵 *${title}*
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
👤 *Artist:* ${artist}
💿 *Album:* ${album}
🎭 *Genre:* ${genre}
📅 *Year:* ${released}
⏱️ *Duration:* ${duration}
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
_Use .lyrics ${title} to get the lyrics_`;

    if (artworkUrl) {
      try {
        const imgRes = await axios.get(artworkUrl, { responseType: 'arraybuffer', timeout: 15000 });
        await sock.sendMessage(from, {
          image: Buffer.from(imgRes.data),
          caption,
          mimetype: 'image/jpeg'
        }, { quoted: msg });
        return;
      } catch {
        // fall through to text reply if image fetch fails
      }
    }

    await send(sock, from, msg, caption);
  } catch (err) {
    await send(sock, from, msg, `❌ Could not fetch song info for "*${text}*".`);
  }
}

async function shazam(ctx) {
  const { sock, from, msg } = ctx;
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted?.audioMessage && !quoted?.videoMessage) {
    return send(sock, from, msg,
      '🎵 *Shazam — Song Recognition*\n\n' +
      'Reply to an audio or video message with `.shazam`\n' +
      'The bot will identify the song for you!\n\n' +
      '_Works best with music clips 10+ seconds long._'
    );
  }
  await send(sock, from, msg, '🎵 Identifying song... please wait...');
  try {
    const qCtx = msg.message.extendedTextMessage.contextInfo;
    const fakeMsg = {
      key: { remoteJid: from, id: qCtx.stanzaId, fromMe: false, participant: qCtx.participant },
      message: quoted
    };
    const stream = await sock.downloadMediaMessage(fakeMsg);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const audioBuf = Buffer.from(chunks);

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuf, { filename: 'audio.mp3', contentType: 'audio/mpeg' });

    const res = await axios.post('https://shazam.p.rapidapi.com/songs/detect', form, {
      headers: {
        ...form.getHeaders(),
        'x-rapidapi-host': 'shazam.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY || ''
      },
      timeout: 30000
    });

    const track = res.data?.track;
    if (!track) throw new Error('Song not recognized');

    const reply =
      `🎵 *Song Identified!*\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `🎤 *Title:* ${track.title || 'Unknown'}\n` +
      `👤 *Artist:* ${track.subtitle || 'Unknown'}\n` +
      `${track.sections?.[0]?.metadata?.[0]?.text ? `💿 *Album:* ${track.sections[0].metadata[0].text}\n` : ''}` +
      `${track.genres?.primary ? `🎭 *Genre:* ${track.genres.primary}\n` : ''}` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `_Use .lyrics ${track.title || ''} to get lyrics_`;

    const imgUrl = track.images?.coverart;
    if (imgUrl) {
      try {
        const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 15000 });
        await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: reply, mimetype: 'image/jpeg' }, { quoted: msg });
        return;
      } catch {}
    }
    await send(sock, from, msg, reply);
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403 || !process.env.RAPIDAPI_KEY) {
      await send(sock, from, msg,
        '🎵 *Shazam*\n\n' +
        '⚠️ Shazam recognition requires a RapidAPI key.\n\n' +
        '*To enable:*\n' +
        '1. Get free key at rapidapi.com\n' +
        '2. Subscribe to Shazam API (free tier)\n' +
        '3. Set RAPIDAPI_KEY in Config Vars\n\n' +
        '_Try `.lyrics <song name>` if you know what song it might be!_'
      );
    } else {
      await send(sock, from, msg, `❌ Shazam failed: ${err.message}\n\n_Try sending a clearer audio clip._`);
    }
  }
}

module.exports = { weather, lyrics, define, yts, imdb, songinfo, shazam };
