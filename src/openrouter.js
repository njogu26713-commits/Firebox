const { GoogleGenAI } = require('@google/genai');

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set. Ask the owner to configure it.');
  return new GoogleGenAI({ apiKey });
}

const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

async function openRouterChat(messages, model) {
  const ai = getClient();

  // Separate system instruction from conversation
  const systemMsg = messages.find(m => m.role === 'system');
  const convoMessages = messages.filter(m => m.role !== 'system');

  // Convert to Gemini format
  const geminiContents = convoMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const modelsToTry = model ? [model] : MODELS;

  for (const m of modelsToTry) {
    try {
      const config = { model: m };
      if (systemMsg) config.systemInstruction = systemMsg.content;

      const response = await ai.models.generateContent({
        ...config,
        contents: geminiContents,
      });

      const text = response.text?.trim();
      if (text) return text;
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate') || msg.includes('503')) {
        console.log(`[AI] ${m} rate-limited, trying next...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error('All Gemini models are currently busy. Please try again in a moment.');
}

async function openRouterPrompt(prompt, model) {
  return openRouterChat([{ role: 'user', content: prompt }], model);
}

async function openRouterVision(imageBuffer, mimeType, prompt) {
  const ai = getClient();
  const base64 = imageBuffer.toString('base64');
  const modelList = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

  for (const m of modelList) {
    try {
      const response = await ai.models.generateContent({
        model: m,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
            { text: prompt || 'Describe this image in detail.' }
          ]
        }]
      });
      const text = response.text?.trim();
      if (text) return text;
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('rate') || msg.includes('503')) {
        console.log(`[AI] ${m} rate-limited, trying next...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error('All Gemini models are currently busy. Please try again in a moment.');
}

module.exports = { openRouterChat, openRouterPrompt, openRouterVision };
