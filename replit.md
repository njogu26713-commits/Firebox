# FireBox Bot

Multi-purpose WhatsApp bot built with Node.js. Uses **Evolution API** (REST + webhooks) as its WhatsApp transport layer instead of the Baileys library directly.

## Architecture

- **Transport:** Evolution API — a separate REST service that manages the WhatsApp connection. The bot communicates with it over HTTP.
- **Incoming messages:** Evolution API POSTs webhook events to `/webhook` on this server.
- **Outgoing messages:** The bot calls Evolution API REST endpoints (`/message/sendText`, `/message/sendMedia`, etc.).
- **Dashboard:** Express web UI served at port 5000.

## Key files

| File | Purpose |
|---|---|
| `index.js` | Entry point — starts DB, web server, session manager |
| `src/evolutionApi.js` | Evolution API adapter — all REST calls + sock-compatible interface |
| `src/sessionManager.js` | Session lifecycle, webhook event routing |
| `src/handler.js` | Message parser and command dispatcher |
| `src/server.js` | Express server — dashboard + `/webhook` endpoint |
| `src/commands/` | All bot command modules |
| `src/mediaCompat.js` | `getContentType` helper (replaces Baileys import) |

## Running

```bash
node index.js
```

The server listens on port 5000.

## Required environment variables

| Variable | Description |
|---|---|
| `EVOLUTION_API_URL` | Base URL of your Evolution API server |
| `EVOLUTION_API_KEY` | Evolution API global API key (set as a Secret) |
| `EVOLUTION_INSTANCE` | Instance name in Evolution API (e.g. `firebox-bot`) |
| `WEBHOOK_URL` | Full webhook URL including path (e.g. `https://your-app.replit.dev/webhook`) — must end in `/webhook` |
| `OWNER_NUMBER` | WhatsApp number with country code, no `+` |
| `OWNER_NAME` | Your name shown in bot responses |
| `PREFIX` | Command prefix (default: `.`) |

Optional:
- `GEMINI_API_KEY` — Google Gemini for AI commands
- `RAPIDAPI_KEY` — Various API commands
- `DEEPAI_KEY` — Image generation

## Evolution API setup

1. Deploy Evolution API separately (Railway, Docker, VPS).
2. Set `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, and `WEBHOOK_URL` in environment variables.
3. Start the bot — it will auto-create the Evolution API instance and register the webhook.
4. Open the dashboard, go to **Pair** to connect your WhatsApp via QR or pairing code (managed through Evolution API).

## User preferences

- Keep existing project structure; do not restructure.
