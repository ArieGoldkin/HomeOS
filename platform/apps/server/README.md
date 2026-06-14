# @homeos/server — WhatsApp webhook service

**M1 milestone: the echo bot.** Proves the WhatsApp *receive → send* loop end-to-end and
establishes the trunk every later phase grafts onto (M2 parse, P1 display). Two guardrails are
locked in from day one: **⚡ ack-then-process** and the **🔒 allowlist gate**.

## Routes

| Method | Path       | Purpose                                                              |
|--------|------------|---------------------------------------------------------------------|
| `GET`  | `/health`  | Liveness (`{ "status": "ok" }`)                                     |
| `GET`  | `/webhook` | Meta verification handshake — echoes `hub.challenge` if token matches |
| `POST` | `/webhook` | Inbound messages — **acks 200 immediately**, then echoes async      |

## Module map (foundation-first seams)

```
src/
├── index.ts        boot: load .env → validate config → start server
├── config.ts       env parse + fail-fast (zod)
├── server.ts       Hono routes; ⚡ ack-then-process
├── webhook.ts      verifyChallenge() + extractMessages()   ← Meta payload shape lives here
├── allowlist.ts    isAllowed()                              🔒 guardrail
├── idempotency.ts  seen(wa_message_id)   ← M2 swaps to SQLite, same interface
├── handler.ts      handleInbound()       ← 🌱 M2 graft point: parse → persist → confirm
└── whatsapp.ts     sendText() via Graph API ← M2 adds media/template helpers
```

## Local run

```bash
# from the monorepo root (platform/):
pnpm install
cp apps/server/env.example apps/server/.env   # then fill in real values
pnpm dev                                       # tsx watch, port 3000
```

`config.ts` fails fast at boot if a required variable is missing or the allowlist is empty.

## One-time WhatsApp setup (your manual steps)

These are Meta-console actions the code can't do for you (roadmap PoC tasks 1–2):

1. **Create a Meta developer account** at <https://developers.facebook.com>, add a **Business**
   app, and add the **WhatsApp** product. This auto-creates a WABA and a **free test number**.
2. **Add up to 5 family recipient numbers** (test numbers can only message pre-added recipients),
   and generate a **permanent system-user token** so the bot doesn't break every 24h.
3. Put `VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, and `ALLOWLIST` into `.env`.

### Expose the webhook for Meta

Meta needs a public HTTPS URL. Use a free, stable tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

In the Meta app → WhatsApp → Configuration, set the **Callback URL** to `https://<tunnel>/webhook`,
the **Verify Token** to your `VERIFY_TOKEN`, and **subscribe to the `messages` field**. Meta will
call `GET /webhook` — a matching token returns the challenge and the webhook goes green.

## 🎯 Demo 1 — prove receive→send

1. `pnpm dev` and start the `cloudflared` tunnel; confirm the webhook verified.
2. From an **allowlisted** family phone, send the bot any text. You should get the **same text echoed back**.
3. Smoke-test the outbound path directly (fill in token + ids):

```bash
curl -X POST "https://graph.facebook.com/v21.0/$PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer $WHATSAPP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"972501234567","type":"text","text":{"body":"ping from HomeOS"}}'
```

A message arriving on the phone proves the send path; the echo proves the full loop.

## Tests

```bash
pnpm test           # 34 unit/integration tests, no live network
pnpm typecheck      # strict TypeScript
pnpm test:cov       # coverage
```

The suite covers config validation, the allowlist gate, idempotent dedupe, Meta payload
extraction (incl. status-only webhooks), the Graph API send contract (mocked `fetch`), echo/refusal
orchestration, and the routes via Hono `app.request()`. The true end-to-end is Demo 1 above.

## Deferred to hardening (deliberate M1 scope cuts)

- **`X-Hub-Signature-256` verification** — Meta signs webhooks with the app secret. Low risk behind
  the allowlist on a 5-number test app; add before leaving the test number. Slots into `webhook.ts`.
- **ESLint** — M1 uses strict TypeScript (`tsc`) as the static gate. Add ESLint/Biome when convenient.

## Deploy (later)

Railway: root directory `platform`, install `pnpm install`, start `pnpm --filter @homeos/server start`.
Set the env vars in Railway's dashboard (`dotenv` no-ops when no `.env` file is present).
