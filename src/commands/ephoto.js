const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TMP = path.join(__dirname, '../../tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const { sendFireboxCard } = require('../card');

async function send(sock, from, msg, text, title) {
  return sendFireboxCard(sock, from, msg, { title: title || '✨ Firebox Effects', content: text });
}

async function sendImageFromUrl(sock, from, msg, url, caption) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  const buf = Buffer.from(res.data);
  await sendFireboxCard(sock, from, msg, {
    title: '✨ Image Effect',
    content: caption || '✅ Effect applied!',
    media: { type: 'image', buffer: buf, mimetype: 'image/jpeg' },
  });
}

async function ephotoApi(endpoint, params) {
  const form = new URLSearchParams({ name: params.text || params.name || '', font: params.font || '1', ...params });
  const res = await axios.post(`https://api.ephoto360.com/${endpoint}/create.php`, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
    timeout: 30000
  });
  const url = res.data?.output || res.data?.download || res.data?.link;
  if (!url) throw new Error('No image URL in response');
  return url;
}

async function pollinationsImage(prompt, width = 800, height = 400) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&enhance=true`;
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000 });
  return Buffer.from(res.data);
}

async function handleEphotoCmd(ctx, label, ephotoSlug, pollinationsPrompt, params = {}) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, `✨ *${label}*\n\nUsage: \`.${ctx.command} <text>\`\nExample: \`.${ctx.command} Firebox\``);
  await send(sock, from, msg, `✨ Creating *${label}* effect for "_${text}_"...`);
  try {
    let imgBuf;
    try {
      const url = await ephotoApi(ephotoSlug, { text, ...params });
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      imgBuf = Buffer.from(res.data);
    } catch {
      imgBuf = await pollinationsImage(`${pollinationsPrompt}: "${text}", high quality, 4K, professional design`);
    }
    await sendFireboxCard(sock, from, msg, {
      title: `✨ ${label}`,
      content: `✅ Effect applied!\n\n📝 *Text:* _"${text}"_`,
      media: { type: 'image', buffer: imgBuf, mimetype: 'image/jpeg' },
    });
  } catch (err) {
    await send(sock, from, msg, `❌ Effect failed: ${err.message}`, `✨ ${label}`);
  }
}

const effects = {
  '1917style':        { label: '1917 Film Style',      slug: '1917-style-text-effect',            prompt: '1917 movie vintage sepia war film style text effect' },
  'advancedglow':     { label: 'Advanced Glow',        slug: 'advanced-glow-effects-online',       prompt: 'advanced glowing neon light text effect dark background' },
  'blackpinklogo':    { label: 'BLACKPINK Logo',       slug: 'blackpink-logo-maker',               prompt: 'BLACKPINK kpop logo style pink black metallic text' },
  'blackpinkstyle':   { label: 'BLACKPINK Style',      slug: 'blackpink-style-text',               prompt: 'BLACKPINK kpop idol style pink glitter text effect' },
  'cartoonstyle':     { label: 'Cartoon Style',        slug: 'cartoon-text-effect-online',         prompt: 'cartoon comic bold colorful text effect pop art style' },
  'deletingtext':     { label: 'Deleting Text',        slug: 'deleting-text-effect',               prompt: 'text being deleted typed on screen digital effect' },
  'dragonball':       { label: 'Dragon Ball',          slug: 'dragon-ball-text-effect',            prompt: 'Dragon Ball Z anime golden energy text effect dramatic' },
  'effectclouds':     { label: 'Effect Clouds',        slug: 'clouds-text-effect-online',          prompt: 'text made of fluffy clouds sky blue dreamy effect' },
  'flag3dtext':       { label: 'Flag 3D Text',         slug: 'flag-3d-text-effect',                prompt: '3D text with flag texture waving country flag effect' },
  'flagtext':         { label: 'Flag Text',            slug: 'flag-text-effect',                   prompt: 'text with national flag colors and texture overlay' },
  'freecreate':       { label: 'Free Create',          slug: 'free-text-effects-online',           prompt: 'creative artistic premium text effect design' },
  'galaxystyle':      { label: 'Galaxy Style',         slug: 'galaxy-style-text-effect-online',    prompt: 'galaxy cosmos nebula stars universe space text effect dark' },
  'galaxywallpaper':  { label: 'Galaxy Wallpaper',     slug: 'galaxy-wallpaper-text',              prompt: 'galaxy wallpaper purple blue space stars text name art' },
  'glitchtext':       { label: 'Glitch Text',          slug: 'glitch-text-effect-online',          prompt: 'digital glitch RGB shift text effect cyberpunk distorted' },
  'glowingtext':      { label: 'Glowing Text',         slug: 'glowing-neon-lights-text-effect-online', prompt: 'glowing neon light text effect dark background bright glow' },
  'gradienttext':     { label: 'Gradient Text',        slug: 'gradient-text-effect-online',        prompt: 'beautiful gradient colorful text effect smooth color transition' },
  'graffiti':         { label: 'Graffiti',             slug: 'graffiti-text-effect-online',        prompt: 'graffiti spray paint street art text effect urban wall' },
  'incandescent':     { label: 'Incandescent',         slug: 'incandescent-text-effect',           prompt: 'incandescent hot glowing metal fire light text effect' },
  'lighteffects':     { label: 'Light Effects',        slug: 'light-text-effect-online',           prompt: 'light burst rays bokeh text effect bright shining' },
  'logomaker':        { label: 'Logo Maker',           slug: 'logo-text-maker-online',             prompt: 'professional logo text maker modern clean design branding' },
  'luxurygold':       { label: 'Luxury Gold',          slug: 'luxury-gold-text-effect',            prompt: 'luxury gold metallic shiny text effect premium elegant' },
  'makingneon':       { label: 'Making Neon',          slug: 'neon-sign-text-effect-online',       prompt: 'neon sign glowing tube light text effect bar sign' },
  'matrix':           { label: 'Matrix',               slug: 'matrix-text-effect-online',          prompt: 'Matrix digital rain green code text effect dark background' },
  'multicoloredneon': { label: 'Multicolored Neon',    slug: 'multicolored-neon-text-effect',      prompt: 'multicolored rainbow neon light text effect dark glow' },
  'neonglitch':       { label: 'Neon Glitch',          slug: 'neon-glitch-text-effect-online',     prompt: 'neon glitch cyberpunk RGB shift glowing text effect dark' },
  'papercutstyle':    { label: 'Papercut Style',       slug: 'paper-cut-text-effect',              prompt: 'paper cut layered shadow text art craft style' },
  'pixelglitch':      { label: 'Pixel Glitch',         slug: 'pixel-glitch-text-effect',           prompt: 'pixel art glitch 8bit retro game text effect' },
  'royaltext':        { label: 'Royal Text',           slug: 'royal-golden-text-effect',           prompt: 'royal crown gold jewel luxury elegant text effect' },
  'sand':             { label: 'Sand Text',            slug: 'sand-text-effect-online',            prompt: 'sand beach written text texture nature desert effect' },
  'summerbeach':      { label: 'Summer Beach',         slug: 'summer-beach-text-effect',           prompt: 'summer beach tropical ocean sunset text effect colorful' },
  'topography':       { label: 'Topography',           slug: 'topography-text-effect',             prompt: 'topographic map contour lines text art geographic style' },
  'typography':       { label: 'Typography',           slug: 'typography-text-effect-online',      prompt: 'beautiful typography artistic font text design poster' },
  'watercolortext':   { label: 'Watercolor Text',      slug: 'watercolor-text-effect-online',      prompt: 'watercolor paint splash artistic text effect soft colors' },
  'writetext':        { label: 'Write Text',           slug: 'write-text-effect-online',           prompt: 'handwriting calligraphy write text effect elegant stroke' },
};

const fns = {};
for (const [cmd, eff] of Object.entries(effects)) {
  fns[cmd] = async function(ctx) {
    return handleEphotoCmd(ctx, eff.label, eff.slug, eff.prompt);
  };
}

module.exports = fns;
