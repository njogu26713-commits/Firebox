const { getContentType } = require('@whiskeysockets/baileys');
const general  = require('./commands/general');
const ai       = require('./commands/ai');
const sticker  = require('./commands/sticker');
const download = require('./commands/download');
const group    = require('./commands/group');
const games    = require('./commands/games');
const search   = require('./commands/search');
const tools    = require('./commands/tools');
const owner    = require('./commands/owner');
const hacking  = require('./commands/hacking');
const audio    = require('./commands/audio');
const ephoto   = require('./commands/ephoto');
const religion = require('./commands/religion');
const db       = require('./database');
const { addActivity } = require('./state');
const { sessions } = require('./sessionManager');


async function handlePendingPrompt(sock, msg, from, sender, body, sessionState) {
  const pick = body?.trim();
  if (!['1', '2', '3'].includes(pick)) return false;

  const entry = sessionState.pendingPrompts.get(sender);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    sessionState.pendingPrompts.delete(sender);
    return false;
  }

  const idx = parseInt(pick, 10) - 1;
  const chosen = entry.prompts[idx];
  if (!chosen) return false;

  sessionState.pendingPrompts.delete(sender);

  if (entry.type === 'chat') {
    await handleMessage(sock, { ...msg, message: { conversation: chosen } }, process.env.PREFIX || '.', sessionState);
  } else {
    const fullCmd = `${entry.cmdPrefix}${chosen}`;
    await sock.sendMessage(from, { text: `🔄 _${fullCmd}_` }, { quoted: msg });
    await handleMessage(sock, { ...msg, message: { conversation: fullCmd } }, process.env.PREFIX || '.', sessionState);
  }

  return true;
}


async function handleMessage(sock, msg, prefix, sessionState) {
  const { key, message } = msg;
  const from = key.remoteJid;
  if (!from) return;
  const botNum = sock.user?.id?.split(':')[0] || '?';
  if (!key.fromMe) console.log(`[MSG][bot:${botNum}] from=${from?.split('@')[0]} type=${Object.keys(message||{})[0]}`);

  const isGroup  = from.endsWith('@g.us');
  const sender   = isGroup
    ? key.participant
    : key.fromMe
      ? (sock.user?.id?.split(':')[0] + '@s.whatsapp.net')
      : key.remoteJid;
  const botNumber = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
  const sessionNumbers = new Set([...sessions.values()].map(s => s.number).filter(Boolean).map(n => n + '@s.whatsapp.net'));
  const isOwner  = key.fromMe || sender === botNumber || sessionNumbers.has(sender) || sender === (process.env.OWNER_NUMBER || '') + '@s.whatsapp.net';

  const type = getContentType(message);
  const body =
    type === 'conversation'              ? message.conversation :
    type === 'imageMessage'              ? (message.imageMessage?.caption || '') :
    type === 'videoMessage'              ? (message.videoMessage?.caption || '') :
    type === 'extendedTextMessage'       ? message.extendedTextMessage?.text :
    type === 'buttonsResponseMessage'    ? message.buttonsResponseMessage?.selectedButtonId :
    type === 'listResponseMessage'       ? message.listResponseMessage?.singleSelectReply?.selectedRowId :
    type === 'interactiveResponseMessage' ? (() => {
      try {
        const p = message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        return p ? JSON.parse(p)?.id : '';
      } catch { return ''; }
    })() :
    '';

  const isCmd   = body?.startsWith(prefix);
  const command = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
  const args    = isCmd ? body.trim().split(/\s+/).slice(1) : [];
  const text    = args.join(' ');

  sessionState.messageCount++;


  // Ignore list gate — silently skip ignored senders
  const ignoreList = db.getBotSetting('ignoreList') || [];
  if (!isOwner && ignoreList.includes(sender)) return;

  if (isGroup) {
    group.trackActivity(from, sender);
    await group.checkAntiLink(sock, msg, from, sender, isOwner);
    await group.checkBadWord(sock, msg, from, sender, isOwner);
    await group.checkAntiForward(sock, msg, from, sender, isOwner);
    await group.checkAntiSticker(sock, msg, from, sender, isOwner);
    await group.checkAntiGroupMention(sock, msg, from, sender, isOwner);
    await group.checkAntiMessage(sock, msg, from, sender, isOwner);
    await group.checkAntiLinkGc(sock, msg, from, sender, isOwner);
  }

  // Dead mode — global setting, blocks ALL non-owner messages with an "offline" notice
  if (!key.fromMe && !isOwner && db.getBotSetting('deadMode')) {
    const DEAD_COOLDOWN = 3 * 60 * 1000;
    const lastReplied = sessionState.deadReplied?.get(from) || 0;
    if (Date.now() - lastReplied > DEAD_COOLDOWN) {
      if (!sessionState.deadReplied) sessionState.deadReplied = new Map();
      const deadMsg = db.getBotSetting('deadMsg') ||
        `💀 *Bot is currently dead / offline.*\n\n_Please try again later or contact the owner._`;
      await sock.sendMessage(from, { text: deadMsg }, { quoted: msg });
      sessionState.deadReplied.set(from, Date.now());
    }
    return;
  }

  // Away mode — per-session, intercepts ALL messages (commands and non-commands) from non-owners
  if (!key.fromMe && !isOwner && body?.trim() && sessionState.awayMode) {
    const AWAY_COOLDOWN = 5 * 60 * 1000; // 5 minutes per sender
    const lastReplied = sessionState.awayReplied.get(from) || 0;
    if (Date.now() - lastReplied > AWAY_COOLDOWN) {
      const awayMsg = sessionState.awayMsg || '👋 Hey! I\'m currently offline/unavailable. I\'ll get back to you as soon as I\'m back. 🙏';
      console.log(`[AWAY][${sessionState.id}] Sending to ${from?.split('@')[0]}: ${awayMsg.slice(0, 30)}`);
      await sock.sendMessage(from, { text: awayMsg }, { quoted: msg });
      sessionState.awayReplied.set(from, Date.now());
    }
    return;
  }

  if (!isCmd && !key.fromMe) {
    const handled = await handlePendingPrompt(sock, msg, from, sender, body, sessionState);
    if (handled) return;
  }

  if (!isCmd) {
    const trivia = db.getTrivia(from);
    if (trivia && body?.toLowerCase().trim() === trivia.answer.toLowerCase().trim()) {
      db.clearTrivia(from);
      await sock.sendMessage(from, {
        text: `🎉 *Correct!* @${sender.split('@')[0]} got it right!\n✅ The answer was: *${trivia.answer}*`,
        mentions: [sender]
      }, { quoted: msg });
    }

    if (!key.fromMe && body?.trim()) {

      if (db.getBotSetting('aiChatbot')) {
        const aiMode = db.getBotSetting('aiChatbotMode') || 'dm';
        const aiTargets = db.getAiChatTargets();
        const aiActive =
          aiMode === 'all' ||
          (aiMode === 'dm' && !isGroup) ||
          (aiMode === 'group' && isGroup) ||
          (aiMode === 'specific' && aiTargets.includes(from));
        if (aiActive) {
          const persona = db.getBotSetting('aiChatbotPersona');
          if (persona) {
            try {
              await sock.sendPresenceUpdate('composing', from).catch(() => {});
              const { openRouterChat } = require('./openrouter');

              const historyKey = sender;
              if (!sessionState.aiChatHistory.has(historyKey)) sessionState.aiChatHistory.set(historyKey, []);
              const history = sessionState.aiChatHistory.get(historyKey);
              const isFirstMessage = history.length === 0;

              const opener = db.getBotSetting('aiChatOpener');
              if (isFirstMessage && opener) await sock.sendMessage(from, { text: opener }, { quoted: msg });

              const systemContent =
                `You are roleplaying as a real person chatting on WhatsApp. Never reveal you are an AI.\n\n` +
                `Who you are:\n${persona}\n\n` +
                `Rules:\n` +
                `- Reply exactly how this person would in real life\n` +
                `- Keep replies short and natural like real WhatsApp texts\n` +
                `- Match their language, slang, tone and emoji style\n` +
                `- Never use markdown formatting (no asterisks, no bullet points)\n` +
                `- Never say you are an AI or a bot\n` +
                `- React naturally to what they said\n` +
                (isFirstMessage
                  ? `- This is their FIRST message to you. After replying, add a warm engaging question or hook at the end to get them talking — make it feel natural, not salesy\n`
                  : `- End your reply with a short follow-up question or hook to keep the conversation going — something natural that fits the flow\n`) +
                `- The hook should feel like a genuine continuation of the chat, not forced\n` +
                `- After your reply, on a new line write PROMPTS: followed by exactly 3 short things the OTHER PERSON might say or ask next. Keep each under 60 characters. Format:\nPROMPTS:\n1. ...\n2. ...\n3. ...\n` +
                `- Give just the reply text and prompts, nothing else. Do not prefix with "You:"`;

              const messages = [
                { role: 'system', content: systemContent },
                ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
                { role: 'user', content: body }
              ];

              const rawAiReply = (await openRouterChat(messages))?.trim().replace(/^You:\s*/i, '');
              if (rawAiReply) {
                const promptMarker = rawAiReply.search(/PROMPTS:/i);
                let aiReply = rawAiReply;
                let chatPrompts = [];

                if (promptMarker !== -1) {
                  aiReply = rawAiReply.slice(0, promptMarker).trim();
                  const promptBlock = rawAiReply.slice(promptMarker + 'PROMPTS:'.length).trim();
                  chatPrompts = promptBlock
                    .split('\n')
                    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
                    .filter(l => l.length > 2)
                    .slice(0, 3);
                }

                history.push({ role: 'user', text: body });
                history.push({ role: 'bot', text: aiReply });
                if (history.length > 20) history.splice(0, history.length - 20);
                sessionState.aiChatHistory.set(historyKey, history);

                setTimeout(async () => {
                  await sock.sendMessage(from, { text: aiReply }, { quoted: msg });
                  if (chatPrompts.length > 0) {
                    const lines = chatPrompts.map((p, i) => `  *${i + 1}.* ${p}`).join('\n');
                    await sock.sendMessage(from, { text: `💬 *Quick replies — send 1, 2 or 3:*\n\n${lines}` }, { quoted: msg });
                    sessionState.pendingPrompts.set(sender, {
                      prompts: chatPrompts, cmdPrefix: '', type: 'chat',
                      expiresAt: Date.now() + 5 * 60 * 1000
                    });
                  }
                }, Math.min(1500, aiReply.length * 30));
                return;
              }
            } catch (aiErr) {
              console.error('[AICHAT] Error:', aiErr.message);
            }
          }
        }
      }

      if (db.getBotSetting('autoReply')) {
        const mode = db.getBotSetting('autoReplyMode') || 'all';
        const shouldReply = mode === 'all' || (mode === 'dm' && !isGroup) || (mode === 'group' && isGroup);
        if (shouldReply) {
          const replyMsg = db.getBotSetting('autoReplyMsg') || '👋 Hello! I am currently unavailable.';
          await sock.sendMessage(from, { text: replyMsg }, { quoted: msg });
        }
      }

    }

    return;
  }

  // ── Private mode gate ─────────────────────────────────────────────────────
  if (!isOwner && db.getBotSetting('botMode') === 'private') {
    await sock.sendMessage(from, { text: '🔒 *Bot is in private mode.*\nOnly the owner can use commands.' }, { quoted: msg });
    return;
  }

  // ── Coin gate — owner/admin coin commands always bypass ────────────────────
  const COIN_BYPASS_CMDS = new Set(['coins', 'addcoins', 'setcoins', 'coinhistory']);
  if (!COIN_BYPASS_CMDS.has(command)) {
    const { balance } = db.getCoins();
    if (balance <= 0) {
      if (!isOwner) {
        await sock.sendMessage(from, {
          text: `🪙 *Bot Out of Coins!*\n\n` +
                `The bot has run out of coins and is temporarily suspended.\n\n` +
                `💳 *To buy coins, send payment to:*\n` +
                `📱 *0118234849*\n\n` +
                `After payment, the admin will top up your coins and the bot will resume.\n\n` +
                `💡 *Coin costs:* AI = 5 · Downloads = 3 · Regular = 1`
        }, { quoted: msg });
        return;
      }
    }
  }

  // ── Coin cost classification ───────────────────────────────────────────────
  const AI_CMDS = new Set(['ai','ask','gemini','gpt','code','programming','blackbox','story','summarize','recipe','teach','analyze','translate','translate2','simi','dalle','imagine','generate','gen','txt2img','deepseek','ds','doppleai','doppel','roleplay']);
  const DL_CMDS = new Set(['play','ytmp3','song','song2','video','ytmp4','tiktok','tt','tiktokaudio','ttaudio','instagram','ig','facebook','fb','twitter','x','pin','pinterest','image','img','apk','mediafire','mf','gdrive','gd','gitclone','git','itunes','telesticker','tgsticker','videodoc','vdoc','download','dl','wallpaper','wp','remini','enhance']);
  const OWNER_CMDS = new Set(['delete','del','block','unblock','restart','react','setprefix','forward','join','leave','setbio','aichat','aibot','autoreply','ar','dead','away','mode','dmgroup','dmall','autoviewstatus','avs','autoreactstatus','ars','statusstats','clearstatusstats','autostatusreply','asr','antideletestatus','ads','broadcaststatus','tostatus','inbox','sharecf','clearcf','schedule','schedulelist','schedules','cancelschedule','broadcast','bc','addbc','removebc','listbc','clearbc','disk','hostip','online','lastseen','ppprivacy','readreceipts','gcaddprivacy','toviewonce','vo','vv2','openvo','dlvo','unblockall','listblocked','groupid','gid','deljunk','update','setprofilepic','spp','aza','setaza','resetaza','autosavestatus','modestatus','setstickercmd','delstickercmd','addsudo','delsudo','listsudo','addignorelist','delignorelist','listignorelist','addcountrycode','delcountrycode','listcountrycode','addbadword','gbw','deletebadword','delbw','listbadword','lbw','alwaysonline','ao','antibug','antiviewonce','avo','autobio','autoblock','autoreact','autoread','autorecord','autorecordtyping','autotype','chatbot','statusdelay','setbotname','setownername','setownernumber','settimezone','setstickerauthor','setstickerpackname','setwatermark','setstatusemoji','setcontextlink','setfont','setmenu','setmenuimage','setwarn','anticalldm','setanticallmsg','delanticallmsg','showanticallmsg','testanticallmsg','delwelcome','showwelcome','testwelcome','delgoodbye','showgoodbye','testgoodbye','getsettings','resetsetting','statussettings','antidelete','antiedit','coins','addcoins','setcoins','coinhistory']);

  let coinCost = 0;
  if (!isOwner && !COIN_BYPASS_CMDS.has(command)) {
    coinCost = AI_CMDS.has(command) ? 5 : DL_CMDS.has(command) ? 3 : OWNER_CMDS.has(command) ? 0 : 1;
  }

  sessionState.commandCount++;
  console.log(`[CMD][${isGroup ? 'GROUP' : 'DM'}] ${sender?.split('@')[0]} → .${command}${text ? ' ' + text.slice(0, 40) : ''}`);
  addActivity(sessionState, 'command', `${sender.split('@')[0]} used .${command}${text ? ' ' + text.slice(0, 30) : ''}`);

  if (isGroup) {
    const grp = db.getGroup(from);
    if (grp.antiban) {
      const delay = Math.floor(Math.random() * 1500) + 500;
      await sock.sendPresenceUpdate('composing', from).catch(() => {});
      await new Promise(r => setTimeout(r, delay));
      await sock.sendPresenceUpdate('paused', from).catch(() => {});
    }
  }

  const ctx = { sock, msg, from, sender, isGroup, isOwner, botNumber, args, text, prefix, command, sessionState };

  switch (command) {

    // ── GENERAL ────────────────────────────────────────────────────────────────
    case 'ping': case 'p':         return general.ping(ctx);
    case 'ping2': case 'p2':       return general.ping2(ctx);
    case 'menu':                   return general.menu(ctx);
    case 'help':                   return general.help(ctx);
    case 'info':                   return general.info(ctx);
    case 'owner':                  return general.owner(ctx);
    case 'runtime':                return general.runtime(ctx);
    case 'botstatus': case 'bs2':  return general.botstatus(ctx);
    case 'pair':                   return general.pair(ctx);
    case 'repo':                   return general.repo(ctx);

    // ── AI ─────────────────────────────────────────────────────────────────────
    case 'ai': case 'ask': case 'gemini': case 'gpt': return ai.chat(ctx);
    case 'code': case 'programming':                   return ai.code(ctx);
    case 'blackbox':                                   return ai.blackbox(ctx);
    case 'story':                                      return ai.story(ctx);
    case 'summarize':                                  return ai.summarize(ctx);
    case 'recipe':                                     return ai.recipe(ctx);
    case 'teach':                                      return ai.teach(ctx);
    case 'analyze':                                    return ai.analyze(ctx);
    case 'translate': case 'translate2':               return ai.translate(ctx);
    case 'simi':                                       return ai.simi(ctx);
    case 'dalle': case 'imagine':                      return ai.dalle(ctx);
    case 'generate': case 'gen': case 'txt2img':       return ai.generate(ctx);
    case 'deepseek': case 'ds':                        return ai.deepseek(ctx);
    case 'doppleai': case 'doppel': case 'roleplay':   return ai.doppleai(ctx);

    // ── STICKER ────────────────────────────────────────────────────────────────
    case 'sticker': case 's': case 'stiker': return sticker.makeSticker(ctx);
    case 'toimg': case 'toimage':            return sticker.stickerToImage(ctx);

    // ── DOWNLOAD ───────────────────────────────────────────────────────────────
    case 'play': case 'ytmp3':             return download.youtubeAudio(ctx);
    case 'song': case 'song2':             return download.song(ctx);
    case 'video': case 'ytmp4':            return download.youtubeVideo(ctx);
    case 'tiktok': case 'tt':             return download.tiktok(ctx);
    case 'tiktokaudio': case 'ttaudio':    return download.tiktokaudio(ctx);
    case 'instagram': case 'ig':           return download.instagram(ctx);
    case 'facebook': case 'fb':            return download.facebook(ctx);
    case 'twitter': case 'x':             return download.twitter(ctx);
    case 'pin': case 'pinterest':          return download.pinterest(ctx);
    case 'savestatus':                     return download.savestatus(ctx);
    case 'image': case 'img':             return download.image(ctx);
    case 'apk':                            return download.apk(ctx);
    case 'mediafire': case 'mf':          return download.mediafire(ctx);
    case 'gdrive': case 'gd':             return download.gdrive(ctx);
    case 'gitclone': case 'git':          return download.gitclone(ctx);
    case 'itunes':                         return download.itunes(ctx);
    case 'telesticker': case 'tgsticker': return download.telesticker(ctx);
    case 'videodoc': case 'vdoc':         return download.videodoc(ctx);
    case 'download': case 'dl':           return download.download(ctx);
    case 'wallpaper': case 'wp':          return download.wallpaper(ctx);
    case 'remini': case 'enhance':        return download.remini(ctx);

    // ── SEARCH ─────────────────────────────────────────────────────────────────
    case 'weather':                        return search.weather(ctx);
    case 'lyrics':                         return search.lyrics(ctx);
    case 'songinfo': case 'si':            return search.songinfo(ctx);
    case 'define': case 'define2':         return search.define(ctx);
    case 'yts':                            return search.yts(ctx);
    case 'imdb':                           return search.imdb(ctx);
    case 'shazam':                         return search.shazam(ctx);

    // ── TOOLS / OTHER ──────────────────────────────────────────────────────────
    case 'read': case 'ocr':              return tools.readImage(ctx);
    case 'qrcode': case 'qr':             return tools.qrcode(ctx);
    case 'tinyurl':                        return tools.tinyurl(ctx);
    case 'fancy':                          return tools.fancy(ctx);
    case 'genpass':                        return tools.genpass(ctx);
    case 'calculate': case 'calc':         return tools.calculate(ctx);
    case 'getpp': case 'pp':              return tools.getpp(ctx);
    case 'time':                           return tools.time(ctx);
    case 'emojimix':                       return tools.emojimix(ctx);
    case 'vv': case 'viewonce':            return tools.viewonce(ctx);
    case 'tts':                            return tools.tts(ctx);
    case 'anon':                           return tools.anon(ctx);
    case 'confess':                        return tools.confess(ctx);
    case 'reverse':                        return tools.reverse(ctx);
    case 'wordcount': case 'wc':           return tools.wordcount(ctx);
    case 'morse':                          return tools.morse(ctx);
    case 'binary':                         return tools.binary(ctx);
    case 'repeat':                         return tools.repeat(ctx);
    case 'age':                            return tools.age(ctx);
    case 'countdown':                      return tools.countdown(ctx);
    case 'rps':                            return tools.rps(ctx);
    case 'compliment':                     return tools.compliment(ctx);
    case 'roast':                          return tools.roast(ctx);
    case 'wyr':                            return tools.wyr(ctx);
    case 'riddle':                         return tools.riddle(ctx);
    case 'guess':                          return tools.numguess(ctx);

    // ── AUDIO ─────────────────────────────────────────────────────────────────
    case 'bass': case 'bassboost':         return audio.bass(ctx);
    case 'blown':                          return audio.blown(ctx);
    case 'deep': case 'deepvoice':         return audio.deep(ctx);
    case 'earrape':                        return audio.earrape(ctx);
    case 'reverseaudio': case 'raudio':    return audio.reverseAudio(ctx);
    case 'robot': case 'robotvoice':       return audio.robot(ctx);
    case 'tomp3':                          return audio.tomp3(ctx);
    case 'toptt': case 'ptt':             return audio.toptt(ctx);
    case 'volaudio': case 'volume':        return audio.volaudio(ctx);

    // ── EPHOTO / IMAGE EFFECTS ────────────────────────────────────────────────
    case 'blur':                                 return ephoto.blur(ctx);
    case 'wasted':                               return ephoto.wasted(ctx);
    case 'wanted':                               return ephoto.wanted(ctx);
    case 'effect3d': case '3deffect':            return ephoto.effect3d(ctx);
    case 'glitch':                               return ephoto.glitch(ctx);
    case 'cartoon':                              return ephoto.cartoon(ctx);
    case 'anime':                                return ephoto.anime(ctx);
    case 'sketch': case 'pencil':               return ephoto.sketch(ctx);
    case 'neon':                                 return ephoto.neon(ctx);
    case 'mirror':                               return ephoto.mirror(ctx);
    case 'frame': case 'photoframe':            return ephoto.frame(ctx);
    case 'graffiti':                             return ephoto.graffiti(ctx);
    case 'invert':                               return ephoto.invert(ctx);
    case 'greyscale': case 'grayscale':          return ephoto.greyscale(ctx);
    case 'sepia':                                return ephoto.sepia(ctx);
    case 'pixelate': case 'pixel':              return ephoto.pixelate(ctx);
    case 'emboss':                               return ephoto.emboss(ctx);
    case 'watercolor':                           return ephoto.watercolor(ctx);
    case 'charcoal':                             return ephoto.charcoal(ctx);
    case 'fire': case 'lavafire':               return ephoto.fire(ctx);
    case 'snow': case 'snoweffect':             return ephoto.snow(ctx);
    case 'rainbow': case 'rainboweffect':       return ephoto.rainbow(ctx);
    case 'vignette':                             return ephoto.vignette(ctx);
    case 'vintage':                              return ephoto.vintage(ctx);
    case 'oil': case 'oilpaint':               return ephoto.oil(ctx);
    case 'hdr':                                  return ephoto.hdr(ctx);
    case 'sharpen':                              return ephoto.sharpen(ctx);
    case 'mosaic':                               return ephoto.mosaic(ctx);
    case 'xray':                                 return ephoto.xray(ctx);
    case 'blueprint':                            return ephoto.blueprint(ctx);
    case 'pop': case 'popart':                 return ephoto.pop(ctx);
    case 'ghosteffect': case 'ghost':           return ephoto.ghosteffect(ctx);
    case 'duotone':                              return ephoto.duotone(ctx);
    case 'comicbook': case 'comic':             return ephoto.comicbook(ctx);

    // ── RELIGION ─────────────────────────────────────────────────────────────
    case 'bible': case 'verse':                  return religion.bible(ctx);
    case 'quran': case 'surah':                  return religion.quran(ctx);

    // ── GAMES / FUN ───────────────────────────────────────────────────────────
    case '8ball':                          return games.eightBall(ctx);
    case 'truth':                          return games.truth(ctx);
    case 'dare':                           return games.dare(ctx);
    case 'truthordare': case 'tod':        return games.truth(ctx);
    case 'trivia':                         return games.trivia(ctx);
    case 'dice': case 'roll':             return games.dice(ctx);
    case 'coinflip': case 'flip':          return games.coinFlip(ctx);
    case 'joke': case 'jokes':             return games.joke(ctx);
    case 'fact': case 'facts':             return games.fact(ctx);
    case 'quote': case 'quotes':           return games.quote(ctx);
    case 'memes': case 'meme':            return games.memes(ctx);
    case 'truthdetector': case 'lie':     return games.truthdetector(ctx);
    case 'xxqc': case 'quickquestion':    return games.xxqc(ctx);

    // ── OWNER ─────────────────────────────────────────────────────────────────
    case 'delete': case 'del':             return owner.deleteMsg(ctx);
    case 'block':                          return owner.block(ctx);
    case 'unblock':                        return owner.unblock(ctx);
    case 'restart':                        return owner.restart(ctx);
    case 'react':                          return owner.react(ctx);
    case 'setprefix':                      return owner.setprefix(ctx);
    case 'forward':                        return owner.forward(ctx);
    case 'join':                           return owner.join(ctx);
    case 'leave':                          return owner.leave(ctx);
    case 'setbio':                         return owner.setbio(ctx);
    case 'aichat': case 'aibot':           return owner.aichat(ctx);
    case 'autoreply': case 'ar':           return owner.autoreply(ctx);
    case 'dead':                           return owner.dead(ctx);
    case 'away':                           return owner.away(ctx);
    case 'mode':                           return owner.mode(ctx);
    case 'dmgroup': case 'dmall':          return owner.dmgroup(ctx);
    case 'autoviewstatus': case 'avs':     return owner.autoviewstatus(ctx);
    case 'autoreactstatus': case 'ars':    return owner.autoreactstatus(ctx);
    case 'statusstats':                    return owner.statusstats(ctx);
    case 'clearstatusstats':               return owner.clearstatusstats(ctx);
    case 'autostatusreply': case 'asr':    return owner.autostatusreply(ctx);
    case 'antideletestatus': case 'ads':   return owner.antideletestatus(ctx);
    case 'broadcaststatus':                return owner.broadcaststatus(ctx);
    case 'tostatus':                       return owner.tostatus(ctx);
    case 'inbox':                          return owner.inbox(ctx);
    case 'sharecf':                        return owner.sharecf(ctx);
    case 'clearcf':                        return owner.clearcf(ctx);
    case 'schedule':                       return owner.schedule(ctx);
    case 'schedulelist': case 'schedules': return owner.schedulelist(ctx);
    case 'cancelschedule':                 return owner.cancelschedule(ctx);
    case 'broadcast': case 'bc':           return owner.broadcast(ctx);
    case 'addbc':                          return owner.addbc(ctx);
    case 'removebc':                       return owner.removebc(ctx);
    case 'listbc':                         return owner.listbc(ctx);
    case 'clearbc':                        return owner.clearbc(ctx);
    case 'disk':                           return owner.disk(ctx);
    case 'hostip':                         return owner.hostip(ctx);
    case 'online':                         return owner.online(ctx);
    case 'lastseen':                       return owner.lastseen(ctx);
    case 'ppprivacy':                      return owner.ppprivacy(ctx);
    case 'readreceipts':                   return owner.readreceipts(ctx);
    case 'gcaddprivacy':                   return owner.gcaddprivacy(ctx);
    case 'toviewonce': case 'vo':         return owner.toviewonce(ctx);
    case 'vv2': case 'openvo':            return owner.vv2(ctx);
    case 'dlvo':                           return owner.dlvo(ctx);
    case 'unblockall':                     return owner.unblockall(ctx);
    case 'listblocked':                    return owner.listblocked(ctx);
    case 'groupid': case 'gid':           return owner.groupid(ctx);
    case 'deljunk':                        return owner.deljunk(ctx);
    case 'update':                         return owner.update(ctx);
    case 'setprofilepic': case 'spp':     return owner.setprofilepic(ctx);
    case 'aza':                            return owner.aza(ctx);
    case 'setaza':                         return owner.setaza(ctx);
    case 'resetaza':                       return owner.resetaza(ctx);
    case 'autosavestatus':                 return owner.autosavestatus(ctx);
    case 'modestatus':                     return owner.modestatus(ctx);
    case 'setstickercmd':                  return owner.setstickercmd(ctx);
    case 'delstickercmd':                  return owner.delstickercmd(ctx);
    case 'addsudo':                        return owner.addsudo(ctx);
    case 'delsudo':                        return owner.delsudo(ctx);
    case 'listsudo':                       return owner.listsudo(ctx);
    case 'addignorelist':                  return owner.addignorelist(ctx);
    case 'delignorelist':                  return owner.delignorelist(ctx);
    case 'listignorelist':                 return owner.listignorelist(ctx);
    case 'addcountrycode':                 return owner.addcountrycode(ctx);
    case 'delcountrycode':                 return owner.delcountrycode(ctx);
    case 'listcountrycode':                return owner.listcountrycode(ctx);
    case 'addbadword': case 'gbw':        return owner.addbadword(ctx);
    case 'deletebadword': case 'delbw':   return owner.deletebadword(ctx);
    case 'listbadword': case 'lbw':       return owner.listbadword(ctx);
    case 'alwaysonline': case 'ao':       return owner.alwaysonline(ctx);
    case 'antibug':                        return owner.antibug(ctx);
    case 'antiviewonce': case 'avo':      return owner.antiviewonce(ctx);
    case 'autobio':                        return owner.autobio(ctx);
    case 'autoblock':                      return owner.autoblock(ctx);
    case 'autoreact':                      return owner.autoreact(ctx);
    case 'autoread':                       return owner.autoread(ctx);
    case 'autorecord':                     return owner.autorecord(ctx);
    case 'autorecordtyping':               return owner.autorecordtyping(ctx);
    case 'autotype':                       return owner.autotype(ctx);
    case 'chatbot':                        return owner.chatbot(ctx);
    case 'statusdelay':                    return owner.statusdelay(ctx);
    case 'setbotname':                     return owner.setbotname(ctx);
    case 'setownername':                   return owner.setownername(ctx);
    case 'setownernumber':                 return owner.setownernumber(ctx);
    case 'settimezone':                    return owner.settimezone(ctx);
    case 'setstickerauthor':               return owner.setstickerauthor(ctx);
    case 'setstickerpackname':             return owner.setstickerpackname(ctx);
    case 'setwatermark':                   return owner.setwatermark(ctx);
    case 'setstatusemoji':                 return owner.setstatusemoji(ctx);
    case 'setcontextlink':                 return owner.setcontextlink(ctx);
    case 'setfont':                        return owner.setfont(ctx);
    case 'setmenu':                        return owner.setmenu(ctx);
    case 'setmenuimage':                   return owner.setmenuimage(ctx);
    case 'setwarn':                        return owner.setwarn(ctx);
    case 'anticalldm':                     return owner.anticalldm(ctx);
    case 'setanticallmsg':                 return owner.setanticallmsg(ctx);
    case 'delanticallmsg':                 return owner.delanticallmsg(ctx);
    case 'showanticallmsg':                return owner.showanticallmsg(ctx);
    case 'testanticallmsg':                return owner.testanticallmsg(ctx);
    case 'delwelcome':                     return owner.delwelcome(ctx);
    case 'showwelcome':                    return owner.showwelcome(ctx);
    case 'testwelcome':                    return owner.testwelcome(ctx);
    case 'delgoodbye':                     return owner.delgoodbye(ctx);
    case 'showgoodbye':                    return owner.showgoodbye(ctx);
    case 'testgoodbye':                    return owner.testgoodbye(ctx);
    case 'getsettings':                    return owner.getsettings(ctx);
    case 'resetsetting':                   return owner.resetsetting(ctx);
    case 'statussettings':                 return owner.statussettings(ctx);
    case 'antidelete':                     return owner.antidelete(ctx);
    case 'antiedit':                       return owner.antiedit(ctx);

    // ── GROUP MANAGEMENT ──────────────────────────────────────────────────────
    case 'kick':                           return group.kick(ctx);
    case 'add':                            return group.add(ctx);
    case 'promote':                        return group.promote(ctx);
    case 'demote':                         return group.demote(ctx);
    case 'mute': case 'close':            return group.mute(ctx);
    case 'unmute': case 'open':           return group.unmute(ctx);
    case 'kickall':                        return group.kickall(ctx);
    case 'setgroupname': case 'rename':    return group.setgroupname(ctx);
    case 'setdesc':                        return group.setdesc(ctx);
    case 'link': case 'invite':            return group.link(ctx);
    case 'resetlink':                      return group.resetlink(ctx);
    case 'tagall': case 'tag':            return group.tagall(ctx);
    case 'hidetag':                        return group.hidetag(ctx);
    case 'tagadmin':                       return group.tagadmin(ctx);
    case 'totalmembers': case 'members':   return group.totalmembers(ctx);
    case 'poll':                           return group.poll(ctx);
    case 'warn':                           return group.warn(ctx);
    case 'listwarn':                       return group.listwarn(ctx);
    case 'resetwarn':                      return group.resetwarn(ctx);
    case 'antiban':                        return group.antiban(ctx);
    case 'antilink':                       return group.antilink(ctx);
    case 'anticall':                       return group.anticall(ctx);
    case 'antibadword': case 'abw':        return group.antibadword(ctx);
    case 'addword': case 'aw':             return group.addword(ctx);
    case 'removeword': case 'rw':          return group.removeword(ctx);
    case 'listwords': case 'lw':           return group.listwords(ctx);
    case 'welcome':                        return group.welcome(ctx);
    case 'setwelcome':                     return group.setwelcome(ctx);
    case 'setgoodbye':                     return group.setgoodbye(ctx);
    case 'groupinfo': case 'ginfo':        return group.groupinfo(ctx);
    case 'antibot':                        return group.antibot(ctx);
    case 'antidemote':                     return group.antidemote(ctx);
    case 'antiforeign':                    return group.antiforeign(ctx);
    case 'antiforward':                    return group.antiforward(ctx);
    case 'antigroupmention': case 'agm':  return group.antigroupmention(ctx);
    case 'antilinkgc': case 'algc':       return group.antilinkgc(ctx);
    case 'antimessage': case 'amsg':      return group.antimessage(ctx);
    case 'antisticker': case 'astick':    return group.antisticker(ctx);
    case 'antitag':                        return group.antitag(ctx);
    case 'antitagadmin': case 'ata':      return group.antitagadmin(ctx);
    case 'listrequests': case 'lr':       return group.listrequests(ctx);
    case 'approve':                        return group.approve(ctx);
    case 'approveall':                     return group.approveall(ctx);
    case 'reject':                         return group.reject(ctx);
    case 'disapproveall':                  return group.disapproveall(ctx);
    case 'addcode':                        return group.addcode(ctx);
    case 'delcode':                        return group.delcode(ctx);
    case 'listcode':                       return group.listcode(ctx);
    case 'allow':                          return group.allow(ctx);
    case 'delallowed':                     return group.delallowed(ctx);
    case 'listallowed':                    return group.listallowed(ctx);
    case 'getgrouppp': case 'ggpp':       return group.getgrouppp(ctx);
    case 'setppgroup': case 'sppg':       return group.setppgroup(ctx);
    case 'delppgroup': case 'dppg':       return group.delppgroup(ctx);
    case 'listactive': case 'la':         return group.listactive(ctx);
    case 'listinactive': case 'li':       return group.listinactive(ctx);
    case 'kickinactive': case 'ki':       return group.kickinactive(ctx);
    case 'vcf':                            return group.vcf(ctx);
    case 'userid': case 'uid':            return group.userid(ctx);
    case 'mediatag': case 'mtag':         return group.mediatag(ctx);
    case 'closetime': case 'ct':          return group.closetime(ctx);
    case 'opentime': case 'ot':           return group.opentime(ctx);
    case 'announcements': case 'annc':    return group.announcements(ctx);
    case 'cancelkick': case 'ck':         return group.cancelkick(ctx);
    case 'editsettings': case 'gsettings':return group.editsettings(ctx);
    case 'fetchgroups':                    return group.fetchgroups(ctx);
    case 'tosgroup':                       return group.tosgroup(ctx);

    // ── HACKING / TOOLS ───────────────────────────────────────────────────────
    case 'checkpass': case 'passcheck':    return hacking.checkpass(ctx);
    case 'hash':                           return hacking.hash(ctx);
    case 'b64encode': case 'encode64':     return hacking.b64encode(ctx);
    case 'b64decode': case 'decode64':     return hacking.b64decode(ctx);
    case 'hexencode':                      return hacking.hexencode(ctx);
    case 'hexdecode':                      return hacking.hexdecode(ctx);
    case 'iplookup': case 'ip':            return hacking.iplookup(ctx);
    case 'dns': case 'dnslookup':          return hacking.dnslookup(ctx);
    case 'whois':                          return hacking.whois(ctx);
    case 'portinfo': case 'port':          return hacking.portinfo(ctx);
    case 'cipher':                         return hacking.cipher(ctx);
    case 'scamalyze': case 'scam':         return hacking.scamalyze(ctx);
    case 'numlookup': case 'numloc':       return hacking.numlookup(ctx);
    case 'sslcheck': case 'ssl':           return hacking.sslcheck(ctx);
    case 'headers': case 'secheaders':     return hacking.headers(ctx);
    case 'subdomains': case 'subd':        return hacking.subdomains(ctx);
    case 'macinfo': case 'mac':            return hacking.macinfo(ctx);
    case 'rot47':                          return hacking.rot47(ctx);
    case 'urlinfo': case 'urlcheck':       return hacking.urlinfo(ctx);
    case 'hack':                           return hacking.hack(ctx);
    case 'fakecall': case 'fc':           return hacking.fakecall(ctx);

    // ── COIN COMMANDS ─────────────────────────────────────────────────────────
    case 'coins': {
      const coinData = db.getCoins();
      const icon = coinData.balance > 200 ? '🟢' : coinData.balance > 50 ? '🟡' : '🔴';
      await sock.sendMessage(from, {
        text: `🪙 *Coin Balance*\n\n` +
              `${icon} *Balance:* ${coinData.balance} coins\n` +
              `📊 *Total Spent:* ${coinData.totalSpent} coins\n\n` +
              `💡 *Costs:* AI = 5 | Downloads = 3 | Regular = 1\n` +
              `_Use .addcoins <amount> to top up (owner only)_`
      }, { quoted: msg });
      return;
    }

    case 'addcoins': {
      if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
      const amt = parseInt(args[0]);
      if (!amt || amt <= 0) return sock.sendMessage(from, { text: '❌ Usage: .addcoins <amount>\nExample: .addcoins 500' }, { quoted: msg });
      const newBal = db.addCoins(amt, `Added by ${sender.split('@')[0]}`);
      await sock.sendMessage(from, {
        text: `✅ *Coins Added!*\n\n🪙 Added: *${amt} coins*\n💰 New Balance: *${newBal} coins*\n\n_Bot is now active!_`
      }, { quoted: msg });
      return;
    }

    case 'setcoins': {
      if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
      const amt = parseInt(args[0]);
      if (isNaN(amt) || amt < 0) return sock.sendMessage(from, { text: '❌ Usage: .setcoins <amount>' }, { quoted: msg });
      const newBal = db.setCoins(amt);
      await sock.sendMessage(from, {
        text: `✅ *Coins Set!*\n\n💰 Balance: *${newBal} coins*`
      }, { quoted: msg });
      return;
    }

    case 'coinhistory': {
      if (!isOwner) return sock.sendMessage(from, { text: '❌ Owner only!' }, { quoted: msg });
      const coinData = db.getCoins();
      const recent = coinData.history.slice(0, 10);
      if (!recent.length) return sock.sendMessage(from, { text: '🪙 No coin history yet.' }, { quoted: msg });
      const lines = recent.map(h => {
        const t = new Date(h.ts).toLocaleTimeString();
        const icon = h.type === 'add' ? '➕' : h.type === 'set' ? '🔧' : '➖';
        return `${icon} ${h.type === 'spend' ? '-' : '+'}${h.amount} — ${h.note} (${t})`;
      }).join('\n');
      await sock.sendMessage(from, {
        text: `🪙 *Coin History (last 10)*\n\n${lines}\n\n💰 *Current:* ${coinData.balance} coins`
      }, { quoted: msg });
      return;
    }

    default: break;
  }

  // ── Deduct coins after successful command ──────────────────────────────────
  if (coinCost > 0) {
    const remaining = db.spendCoins(coinCost, `.${command}`);
    if (remaining === 0) {
      console.log(`[COINS] Balance hit 0 — bot suspended until coins are topped up`);
      const ownerNumber = process.env.OWNER_NUMBER;
      if (ownerNumber) {
        try {
          const ownerJid = ownerNumber + '@s.whatsapp.net';
          await sock.sendMessage(ownerJid, {
            text: `⚠️ *Firebox Alert: Coins Depleted!*\n\nThe bot has run out of coins and is now suspended.\n\n💡 Top up using:\n*.addcoins <amount>*\nor via the dashboard.\n\n_Last command: .${command}_`
          });
        } catch (_) {}
      }
    }
  }
}

module.exports = { handleMessage };
