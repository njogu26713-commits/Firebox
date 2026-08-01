# FireBox Bot

Multi-purpose WhatsApp bot built with Node.js. Uses **@whiskeysockets/baileys** directly for the WhatsApp WebSocket connection.

## Architecture

- **Transport:** Native Baileys — direct WebSocket connection to WhatsApp (no external Evolution API server needed).
- **Incoming messages:** Baileys emits events in-process (`messages.upsert`, `group-participants.update`, `call`, etc.).
- **Outgoing messages:** Standard Baileys `sock.sendMessage(jid, payload)` calls.
- **Dashboard:** Express web UI served at port 5000.
- **Sessions:** Auth state persisted to `./session/<id>/creds.json` (mount a volume on Railway to survive restarts).

## Key files

| File | Purpose |
|---|---|
| `index.js` | Entry point — starts DB, web server, session manager |
| `src/sessionManager.js` | Baileys session lifecycle, event routing |
| `src/handler.js` | Message parser and command dispatcher |
| `src/server.js` | Express server — dashboard API |
| `src/commands/` | All bot command modules |
| `src/mediaCompat.js` | `getContentType` / `downloadMediaBuffer` helpers |
| `src/commands/download.js` | `.play`, `.video`, and other media download commands |

## Running

```bash
node index.js
```

Server listens on port 5000. On first run (no saved session), open the dashboard and use the pairing code or QR code flow to link a WhatsApp number.

> **Note:** Replit's egress network blocks outbound WhatsApp WebSocket connections, so the bot will only connect when deployed to Railway (or a VPS). The dashboard and all non-WhatsApp features work fine on Replit for development.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `OWNER_NUMBER` | ✓ | WhatsApp number with country code, no `+` (e.g. `2547XXXXXXXX`) |
| `OWNER_NAME` | | Your name shown in bot responses |
| `PREFIX` | | Command prefix (default: `.`) |
| `TZ` | | Timezone (default: `Africa/Nairobi`) |
| `GEMINI_API_KEY` | | Google Gemini for AI commands |
| `RAPIDAPI_KEY` | | Various API commands |
| `DEEPAI_KEY` | | Image generation |
| `MONGODB_URI` | | MongoDB connection string (falls back to JSON files if not set) |

## Deploying to Railway

1. Push this repo to GitHub.
2. Create a new Railway project from the repo — it will use the `Dockerfile`.
3. Add a **Volume** mounted at `/app/session` so WhatsApp credentials survive redeploys.
4. Set `OWNER_NUMBER` and any optional API keys as Railway environment variables.
5. Deploy — open the Railway public URL, go to `/pair` to link your WhatsApp number.

## `.play` / `.video` commands

Both use `yt-dlp` + `ffmpeg`. The Dockerfile installs them during build and caches the binary at `bin/yt-dlp`. On Railway this works out of the box.

## User preferences

- Keep existing project structure; do not restructure.
