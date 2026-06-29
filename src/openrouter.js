const Groq = require('groq-sdk');

const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

function getClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set. Ask the owner to configure it.');
  return new Groq({ apiKey });
}

async function openRouterChat(messages, model) {
  const groq = getClient();
  const modelsToTry = model ? [model] : MODELS;

  for (const m of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model: m,
        messages,
        max_tokens: 1024,
      });
      const text = completion.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('rate') || msg.includes('quota') || msg.includes('503')) {
        console.log(`[AI] ${m} rate-limited, trying next...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error('All AI models are currently busy. Please try again in a moment.');
}

async function openRouterPrompt(prompt, model) {
  return openRouterChat([{ role: 'user', content: prompt }], model);
}

async function openRouterVision(imageBuffer, mimeType, prompt) {
  const groq = getClient();
  const base64 = imageBuffer.toString('base64');

  try {
    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64}` } },
          { type: 'text', text: prompt || 'Describe this image in detail.' }
        ]
      }],
      max_tokens: 512,
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (text) return text;
  } catch (err) {
    console.error('[AI Vision] Groq vision failed:', err.message);
  }

  throw new Error('Vision analysis is currently unavailable. Please try again.');
}

module.exports = { openRouterChat, openRouterPrompt, openRouterVision };
