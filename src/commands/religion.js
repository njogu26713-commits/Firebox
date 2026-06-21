const axios = require('axios');

async function send(sock, from, msg, text) {
  const lines = text.split('\n');
  if (/\*[^*\n]+\*/.test(lines[0])) lines[0] = '> ' + lines[0];
  await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: msg });
}

async function bible(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) {
    return send(sock, from, msg,
      '📖 *Bible Verse*\n\n' +
      'Usage:\n' +
      '  `.bible John 3:16`\n' +
      '  `.bible Psalms 23:1-6`\n' +
      '  `.bible random`\n\n' +
      '_Supports all books: Genesis, Exodus, Psalms, Proverbs, Matthew, John, Romans, etc._'
    );
  }

  const randomVerses = [
    'John 3:16', 'Psalms 23:1', 'Proverbs 3:5-6', 'Romans 8:28',
    'Philippians 4:13', 'Jeremiah 29:11', 'Isaiah 40:31', 'Matthew 6:33',
    'Joshua 1:9', '1 Corinthians 13:4-7', 'Psalms 46:1', 'John 14:6'
  ];

  const query = text.trim().toLowerCase() === 'random'
    ? randomVerses[Math.floor(Math.random() * randomVerses.length)]
    : text.trim();

  await send(sock, from, msg, `📖 Fetching *${query}*...`);

  try {
    const encoded = encodeURIComponent(query);
    const res = await axios.get(`https://bible-api.com/${encoded}?translation=kjv`, { timeout: 15000 });
    const d = res.data;

    if (!d.verses || d.verses.length === 0) {
      return send(sock, from, msg, `❌ Verse not found: *${query}*\n\nTry: \`.bible John 3:16\` or \`.bible random\``);
    }

    const verseText = d.verses.map(v => `[${v.verse}] ${v.text.trim()}`).join('\n');
    const reference = d.reference || query;
    const translation = (d.translation_name || 'King James Version').toUpperCase();

    const reply =
      `📖 *${reference}*\n` +
      `📜 _${translation}_\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
      `${verseText}\n\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      `_Type .bible random for a random verse_`;

    await send(sock, from, msg, reply);
  } catch (err) {
    await send(sock, from, msg,
      `❌ Could not fetch verse: *${query}*\n\n` +
      `Make sure the format is correct:\n` +
      `• \`.bible John 3:16\`\n` +
      `• \`.bible Psalms 23:1-6\`\n` +
      `• \`.bible random\``
    );
  }
}

async function quran(ctx) {
  const { sock, from, msg, args, text } = ctx;
  if (!text) {
    return send(sock, from, msg,
      '🕌 *Quran Verse*\n\n' +
      'Usage:\n' +
      '  `.quran 2:255` _(Surah:Ayah)_\n' +
      '  `.quran 1` _(entire surah)_\n' +
      '  `.quran random`\n\n' +
      '_Example: .quran 36:1 (Surah Yasin, verse 1)_'
    );
  }

  const randomAyahs = ['1:1', '2:255', '36:1', '67:1', '112:1', '114:1', '55:1', '18:1'];

  let surah, ayah;
  if (text.trim().toLowerCase() === 'random') {
    const pick = randomAyahs[Math.floor(Math.random() * randomAyahs.length)];
    [surah, ayah] = pick.split(':').map(Number);
  } else if (text.includes(':')) {
    [surah, ayah] = text.trim().split(':').map(Number);
  } else {
    surah = parseInt(text.trim());
    ayah = null;
  }

  if (!surah || isNaN(surah) || surah < 1 || surah > 114) {
    return send(sock, from, msg, `❌ Invalid surah number. Must be 1–114.\n\nExample: \`.quran 2:255\``);
  }

  await send(sock, from, msg, `🕌 Fetching *Surah ${surah}${ayah ? ':' + ayah : ''}*...`);

  try {
    let apiUrl, isFullSurah = false;
    if (ayah) {
      apiUrl = `https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/editions/quran-uthmani,en.asad`;
    } else {
      apiUrl = `https://api.alquran.cloud/v1/surah/${surah}/editions/quran-uthmani,en.asad`;
      isFullSurah = true;
    }

    const res = await axios.get(apiUrl, { timeout: 15000 });
    const d = res.data;

    if (d.code !== 200) return send(sock, from, msg, `❌ Verse not found. Try: \`.quran 2:255\``);

    if (ayah) {
      const arabic = d.data[0];
      const english = d.data[1];
      const surahName = arabic.surah?.englishName || `Surah ${surah}`;
      const surahArabic = arabic.surah?.name || '';

      const reply =
        `🕌 *${surahName}* ${surahArabic ? `(${surahArabic})` : ''}\n` +
        `📍 _Surah ${surah}, Ayah ${ayah}_\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
        `*Arabic:*\n${arabic.text}\n\n` +
        `*English (Asad):*\n_${english.text}_\n\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
        `_Type .quran random for a random verse_`;

      await send(sock, from, msg, reply);
    } else {
      const arabicData = d.data[0];
      const englishData = d.data[1];
      const surahInfo = arabicData.englishName || `Surah ${surah}`;
      const ayahs = arabicData.ayahs || [];
      const engAyahs = englishData.ayahs || [];

      const totalAyahs = ayahs.length;
      const preview = ayahs.slice(0, 5).map((a, i) =>
        `[${a.numberInSurah}] ${engAyahs[i]?.text || ''}`
      ).join('\n');

      const reply =
        `🕌 *${surahInfo}*\n` +
        `📍 _Surah ${surah} — ${totalAyahs} ayahs_\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n` +
        `*Arabic (First Ayah):*\n${ayahs[0]?.text || ''}\n\n` +
        `*English Translation:*\n${preview}${totalAyahs > 5 ? `\n\n_...and ${totalAyahs - 5} more ayahs_` : ''}\n\n` +
        `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
        `_Use .quran ${surah}:1 to get specific ayah_`;

      await send(sock, from, msg, reply);
    }
  } catch (err) {
    await send(sock, from, msg,
      `❌ Could not fetch Quran verse.\n\n` +
      `Try:\n• \`.quran 2:255\`\n• \`.quran 1\`\n• \`.quran random\``
    );
  }
}

module.exports = { bible, quran };
