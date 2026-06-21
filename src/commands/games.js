const db = require('../database');
const axios = require('axios');

const TRUTHS = [
  "What's your biggest fear?",
  "What's the most embarrassing thing you've ever done?",
  "Have you ever lied to someone you love?",
  "What's your biggest regret?",
  "Have you ever cheated on a test?",
  "What's the weirdest dream you've ever had?",
  "What's something you've never told anyone?",
  "What's the worst thing you've ever said to someone?",
  "Have you ever broken something and blamed someone else?",
  "What's your biggest insecurity?",
  "Have you ever pretended to be sick to avoid something?",
  "What habit do you have that you're embarrassed about?",
  "What's the most childish thing you still do?",
  "What's a lie you've told that you regret?",
  "What do you do when no one is watching?",
  "Who was your first crush?",
  "What's the most embarrassing thing on your phone?",
  "Have you ever said something behind someone's back that you regret?",
  "What's the most times you've watched the same movie?",
  "Would you rather be rich or famous?"
];

const DARES = [
  "Send a selfie to the group right now!",
  "Do 20 push-ups and post proof.",
  "Change your profile picture to a funny face for 1 hour.",
  "Text your crush something nice right now!",
  "Do your best impression of someone in this group.",
  "Speak in an accent for the next 5 minutes.",
  "Send the 10th photo in your camera roll.",
  "Say something nice about every person in this group.",
  "Do a 30-second dance and send a video.",
  "Eat a spoonful of hot sauce (or something spicy).",
  "Post a cringe caption as your WhatsApp status.",
  "Go outside and say your name loudly 3 times.",
  "Do 15 jumping jacks right now!",
  "Call a family member and tell them a joke.",
  "Let someone in the group post anything as your status for 1 hour.",
  "Sing the first 30 seconds of any song in a voice note.",
  "Write a poem about the person above you in the chat.",
  "Describe yourself in 3 emojis only.",
  "Share the most recent meme you saved.",
  "Set any contact name to 'My Bestie 💕' for an hour."
];

async function eightBall(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) {
    return sock.sendMessage(from, { text: '🎱 Ask me a yes/no question!\n\n*Example:* .8ball Will I be rich?' }, { quoted: msg });
  }

  const responses = [
    '✅ It is certain.', '✅ It is decidedly so.', '✅ Without a doubt.',
    '✅ Yes, definitely.', '✅ You may rely on it.', '✅ As I see it, yes.',
    '✅ Most likely.', '✅ Outlook good.', '✅ Yes.',
    '✅ Signs point to yes.', '🤷 Reply hazy, try again.',
    '🤷 Ask again later.', '🤷 Better not tell you now.',
    '🤷 Cannot predict now.', '🤷 Concentrate and ask again.',
    '❌ Don\'t count on it.', '❌ My reply is no.',
    '❌ My sources say no.', '❌ Outlook not so good.', '❌ Very doubtful.'
  ];

  const answer = responses[Math.floor(Math.random() * responses.length)];
  await sock.sendMessage(from, {
    text: `🎱 *Magic 8 Ball*\n\n❓ _${text}_\n\n${answer}`
  }, { quoted: msg });
}

async function truth(ctx) {
  const { sock, from, msg } = ctx;
  const q = TRUTHS[Math.floor(Math.random() * TRUTHS.length)];
  await sock.sendMessage(from, { text: `💬 *TRUTH*\n━━━━━━━━━━━━\n${q}` }, { quoted: msg });
}

async function dare(ctx) {
  const { sock, from, msg } = ctx;
  const d = DARES[Math.floor(Math.random() * DARES.length)];
  await sock.sendMessage(from, { text: `🎯 *DARE*\n━━━━━━━━━━━━\n${d}` }, { quoted: msg });
}

async function trivia(ctx) {
  const { sock, from, msg } = ctx;

  const existing = db.getTrivia(from);
  if (existing) {
    return sock.sendMessage(from, {
      text: `❓ There's an active trivia!\n\n*Q:* ${existing.question}\n\n_Type your answer!_`
    }, { quoted: msg });
  }

  try {
    const res = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 10000 });
    const item = res.data.results[0];

    const decode = str => str
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const question = decode(item.question);
    const answer = decode(item.correct_answer);
    const allAnswers = [...item.incorrect_answers.map(decode), answer].sort(() => Math.random() - 0.5);

    db.setTrivia(from, question, answer);

    const text = `
🎯 *TRIVIA TIME!*
━━━━━━━━━━━━━━━━━━
📚 *Category:* ${item.category}
🎯 *Difficulty:* ${item.difficulty.toUpperCase()}

❓ ${question}

${allAnswers.map((a, i) => `${['🇦', '🇧', '🇨', '🇩'][i]} ${a}`).join('\n')}
━━━━━━━━━━━━━━━━━━
_You have 60 seconds to answer!_
    `.trim();

    await sock.sendMessage(from, { text }, { quoted: msg });

    setTimeout(async () => {
      const current = db.getTrivia(from);
      if (current) {
        db.clearTrivia(from);
        await sock.sendMessage(from, {
          text: `⏰ *Time's up!*\n\n✅ The answer was: *${answer}*`
        });
      }
    }, 60000);
  } catch (err) {
    await sock.sendMessage(from, { text: '❌ Could not fetch trivia. Try again!' }, { quoted: msg });
  }
}

async function dice(ctx) {
  const { sock, from, msg, text } = ctx;
  const sides = Math.min(parseInt(text) || 6, 1000);
  const result = Math.floor(Math.random() * sides) + 1;
  const dieFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const display = sides === 6 ? dieFaces[result - 1] : `*${result}*`;
  await sock.sendMessage(from, {
    text: `🎲 Rolling a *${sides}*-sided die...\n\n${display} — You got *${result}*!`
  }, { quoted: msg });
}

async function coinFlip(ctx) {
  const { sock, from, msg } = ctx;
  const result = Math.random() < 0.5 ? '🪙 *HEADS!*' : '🪙 *TAILS!*';
  await sock.sendMessage(from, {
    text: `🪙 *Coin Flip*\n\nFlipping...\n\n${result}`
  }, { quoted: msg });
}

async function joke(ctx) {
  const { sock, from, msg } = ctx;
  const fallback = [
    { setup: "Why don't scientists trust atoms?", punchline: "Because they make up everything!" },
    { setup: "Why did the scarecrow win an award?", punchline: "He was outstanding in his field!" },
    { setup: "I told my wife she was drawing her eyebrows too high.", punchline: "She looked surprised!" },
    { setup: "Why can't you give Elsa a balloon?", punchline: "Because she'll let it go!" },
    { setup: "What do you call a fake noodle?", punchline: "An impasta!" }
  ];

  try {
    const res = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 8000 });
    await sock.sendMessage(from, {
      text: `😂 *JOKE*\n\n${res.data.setup}\n\n_${res.data.punchline}_`
    }, { quoted: msg });
  } catch {
    const j = fallback[Math.floor(Math.random() * fallback.length)];
    await sock.sendMessage(from, {
      text: `😂 *JOKE*\n\n${j.setup}\n\n_${j.punchline}_`
    }, { quoted: msg });
  }
}

async function fact(ctx) {
  const { sock, from, msg } = ctx;
  const fallback = [
    "Honey never spoils. Archaeologists found 3,000-year-old honey in Egyptian tombs that was still edible.",
    "A day on Venus is longer than a year on Venus.",
    "Octopuses have three hearts and blue blood.",
    "The shortest war in history lasted 38-45 minutes — the Anglo-Zanzibar War of 1896.",
    "Bananas are berries, but strawberries are not.",
    "A group of flamingos is called a 'flamboyance'.",
    "The average person walks about 100,000 miles in their lifetime — roughly 4 times around the Earth."
  ];

  try {
    const res = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { timeout: 8000 });
    await sock.sendMessage(from, {
      text: `🧠 *RANDOM FACT*\n\n${res.data.text}`
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(from, {
      text: `🧠 *RANDOM FACT*\n\n${fallback[Math.floor(Math.random() * fallback.length)]}`
    }, { quoted: msg });
  }
}

async function quote(ctx) {
  const { sock, from, msg } = ctx;
  const fallback = [
    { content: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { content: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
    { content: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
    { content: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
    { content: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" }
  ];

  try {
    const res = await axios.get('https://api.quotable.io/random', { timeout: 8000 });
    await sock.sendMessage(from, {
      text: `💫 *QUOTE*\n\n_"${res.data.content}"_\n\n— *${res.data.author}*`
    }, { quoted: msg });
  } catch {
    const q = fallback[Math.floor(Math.random() * fallback.length)];
    await sock.sendMessage(from, {
      text: `💫 *QUOTE*\n\n_"${q.content}"_\n\n— *${q.author}*`
    }, { quoted: msg });
  }
}

async function memes(ctx) {
  const { sock, from, msg } = ctx;
  try {
    const res = await axios.get('https://meme-api.com/gimme', { timeout: 12000 });
    const d = res.data;
    if (!d?.url) throw new Error('No meme URL');
    const imgRes = await axios.get(d.url, { responseType: 'arraybuffer', timeout: 20000 });
    await sock.sendMessage(from, {
      image: Buffer.from(imgRes.data),
      caption: `😂 *${d.title || 'Random Meme'}*\n👍 ${d.ups?.toLocaleString() || '?'} upvotes — r/${d.subreddit || 'memes'}`,
      mimetype: 'image/jpeg'
    }, { quoted: msg });
  } catch {
    const fallbackMemes = [
      'https://i.imgur.com/5e5Ih2K.jpeg',
      'https://i.imgur.com/3mv3HSa.jpeg',
      'https://i.imgur.com/8hZf2Mo.jpeg'
    ];
    const url = fallbackMemes[Math.floor(Math.random() * fallbackMemes.length)];
    try {
      const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      await sock.sendMessage(from, { image: Buffer.from(r.data), caption: '😂 *Random Meme*', mimetype: 'image/jpeg' }, { quoted: msg });
    } catch {
      await sock.sendMessage(from, { text: '😂 *Meme*\n\nWhy do programmers prefer dark mode?\n\n_Because light attracts bugs!_ 🐛' }, { quoted: msg });
    }
  }
}

async function truthdetector(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return sock.sendMessage(from, {
    text: '🔍 *Truth Detector*\n\nUsage: `.truthdetector <statement>`\nExample: `.truthdetector I never eat junk food`\n\n_Warning: purely for fun! 😂_'
  }, { quoted: msg });

  const results = [
    { emoji: '✅', label: '100% TRUE', percent: 100, desc: 'Absolutely no doubt about it!' },
    { emoji: '🟢', label: '87% TRUE', percent: 87, desc: 'Mostly believable, with minor doubts.' },
    { emoji: '🟡', label: '50% TRUE', percent: 50, desc: 'Half truth, half story 👀' },
    { emoji: '🟠', label: '23% TRUE', percent: 23, desc: 'Mostly false. Nice try though! 😂' },
    { emoji: '❌', label: '0% TRUE', percent: 0, desc: 'This is a whole LIE! 🤥' },
    { emoji: '🤔', label: 'SUSPICIOUS', percent: 42, desc: 'Something doesn\'t add up here...' },
    { emoji: '😂', label: 'LAUGHABLY FALSE', percent: 5, desc: 'Not even close to truth!' },
    { emoji: '🔥', label: '99% TRUE', percent: 99, desc: 'Almost definitely happened!' },
  ];

  const hash = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const result = results[hash % results.length];
  const bar = '█'.repeat(Math.floor(result.percent / 10)) + '░'.repeat(10 - Math.floor(result.percent / 10));

  await sock.sendMessage(from, {
    text: `🔍 *Truth Detector*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n📋 Statement:\n_"${text}"_\n\n${result.emoji} *Result: ${result.label}*\n[${bar}] ${result.percent}%\n\n📝 ${result.desc}\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n_⚠️ For fun only — not a real lie detector!_`
  }, { quoted: msg });
}

async function xxqc(ctx) {
  const { sock, from, msg } = ctx;
  const questions = [
    "If you could live anywhere in the world, where would it be and why?",
    "What's the most embarrassing thing you did as a kid?",
    "If you could have any superpower, what would it be?",
    "What's your most used emoji and what does it say about you?",
    "If your life was a movie, what genre would it be?",
    "What's a skill you wish you had but don't?",
    "If you could have dinner with anyone (living or dead), who would it be?",
    "What's your hottest take that most people would disagree with?",
    "If you woke up as the opposite gender for a day, what's the first thing you'd do?",
    "What's the weirdest food combination you actually enjoy?",
    "What would you do if you won $1 million right now?",
    "If animals could talk, which animal would be the rudest?",
  ];
  const q = questions[Math.floor(Math.random() * questions.length)];
  await sock.sendMessage(from, {
    text: `💬 *Quick Question*\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n\n🤔 ${q}\n\n▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰\n_Reply with your answer!_`
  }, { quoted: msg });
}

module.exports = { eightBall, truth, dare, trivia, dice, coinFlip, joke, fact, quote, memes, truthdetector, xxqc };
