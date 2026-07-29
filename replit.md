# FireBox Bot

A multi-purpose WhatsApp bot built with Node.js using the Baileys library. Provides a web dashboard for managing bot sessions, an activation/licence system, group management, AI chat, media tools, and more.

## How to run

```
node index.js
```

The bot starts on **port 5000**. Open the Preview tab to access the dashboard.

## Project structure

```
index.js              — entry point: DB init → server → sessions
src/
  server.js           — Express web server + all API routes (port 5000)
  sessionManager.js   — Baileys WhatsApp session lifecycle management
  database.js         — JSON-file storage (optional MongoDB sync)
  handler.js          — WhatsApp message handler + command routing
  mpesa.js            — M-Pesa Daraja STK push integration
  card.js             — Styled WhatsApp message cards
  commands/           — Individual bot command modules
public/
  dashboard.html      — Main bot dashboard
  activate.html       — Licence activation / reconnect page
  get-token.html      — Generate a new activation token
  admin.html          — Admin panel
  config.html         — Bot configuration
data/                 — JSON storage files (auto-created)
session/              — Baileys session credential files
```

## Activation / Licence system

Tokens are permanent licences tied to one WhatsApp number:

1. **Get Token** (`/get-token`) — Enter a WhatsApp number; a token is generated and permanently locked to it.
2. **Activate** (`/activate`) — Enter the token:
   - If **active** (paid, not expired): generates a new pairing code immediately — no payment.
   - If **inactive / expired**: choose a plan, pay via M-Pesa, then get a pairing code.
3. **Renewal**: enter the same token after expiry — pay again to extend the same licence.

Token status lifecycle: `inactive → active → expired / suspended`

Background job runs every 5 minutes to expire active tokens past their `expiresAt` and remove their sessions.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OWNER_NUMBER` | Yes | WhatsApp number with country code, no `+` (e.g. `254712345678`) |
| `OWNER_NAME` | No | Name shown in bot responses |
| `PREFIX` | No | Command prefix (default `.`) |
| `TZ` | No | Timezone (default `Africa/Nairobi`) |
| `GEMINI_API_KEY` | No | Google Gemini AI key (for AI commands) |
| `RAPIDAPI_KEY` | No | RapidAPI key (for various API commands) |
| `DEEPAI_KEY` | No | DeepAI key (for image generation) |
| `MONGODB_URI` | No | MongoDB connection string (falls back to JSON files) |
| `MPESA_CONSUMER_KEY` | No | Daraja API consumer key |
| `MPESA_CONSUMER_SECRET` | No | Daraja API consumer secret |
| `MPESA_SHORTCODE` | No | M-Pesa shortcode |
| `MPESA_PASSKEY` | No | M-Pesa passkey |
| `MPESA_TEST_MODE` | No | Set `true` to auto-confirm payments without real M-Pesa |
| `SESSION_ID` | No | Base64 session bundle to import on startup |

## User preferences

- Keep the project's existing structure and stack.
