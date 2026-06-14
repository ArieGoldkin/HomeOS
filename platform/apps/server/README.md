# @homeos/server — WhatsApp webhook service

**M2 milestone: forward → parse → confirm.** A forwarded Hebrew (or mixed) message is parsed by
Claude into a structured calendar item, persisted to SQLite, and acknowledged with a Hebrew
confirmation. Built on the M1 trunk — the **⚡ ack-then-process** and **🔒 allowlist** guardrails are
unchanged. (M1 was the echo bot; voice notes are deferred to **M2b**.)

## What happens to an inbound message

```
POST /webhook → ack 200 → (async) dedupe → allowlist → parse (Claude) → save (SQLite) → confirm
                                              │ not text        │ unparseable
                                              ▼                 ▼
                                       "text only 🙏"    "couldn't understand, rephrase?"
```

A successful parse replies, e.g.: `הוספתי ליומן ✓\nאסיפת הורים · 2026-06-21 18:30`

## Routes

| Method | Path       | Purpose                                                                |
|--------|------------|------------------------------------------------------------------------|
| `GET`  | `/health`  | Liveness (`{ "status": "ok" }`)                                       |
| `GET`  | `/webhook` | Meta verification handshake — echoes `hub.challenge` if token matches   |
| `POST` | `/webhook` | Inbound messages — **acks 200 immediately**, then parses/persists async |

## Module map (foundation-first seams)

```
src/
├── index.ts        boot: load .env → validate config → wire Claude + store → start server
├── config.ts       env parse + fail-fast (zod): tokens, ALLOWLIST, ANTHROPIC_MODEL, DB_PATH
├── server.ts       Hono routes; ⚡ ack-then-process
├── webhook.ts      verifyChallenge() + extractMessages()   ← Meta payload shape lives here
├── allowlist.ts    isAllowed()                              🔒 guardrail
├── idempotency.ts  seen(wa_message_id)                      (in-memory; bounded)
├── parse.ts        Claude structured output → ParsedEvent   (@anthropic-ai/sdk, injectable)
├── schema.ts       events table DDL + row type
├── db.ts           EventStore (node:sqlite)                 ← Drizzle layerable behind this iface
├── handler.ts      handleInbound(): parse → persist → confirm
└── whatsapp.ts     sendText() via Graph API                 ← M2b adds media download
```

The `ParsedEvent` contract lives in `@homeos/shared` (so the P1 kitchen display consumes the same shape).

## Local run

```bash
# from the monorepo root (platform/):
pnpm install
cp apps/server/env.example apps/server/.env   # then fill in real values + your ANTHROPIC_API_KEY
pnpm dev                                       # tsx watch, port 3000
```

`config.ts` fails fast if a required var is missing or the allowlist is empty. The Anthropic key is
read from the environment by the SDK; the SQLite file is created at `DB_PATH` (default `./data/homeos.db`).

## One-time WhatsApp setup (your manual steps)

Meta-console actions the code can't do for you:

1. **Create a Meta developer account** at <https://developers.facebook.com>, add a **Business** app,
   add the **WhatsApp** product (auto-creates a WABA + a **free test number**).
2. **Add up to 5 family recipient numbers** + generate a **permanent system-user token**.
3. Put `VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `ALLOWLIST`, and `ANTHROPIC_API_KEY` into `.env`.

### Expose the webhook for Meta

```bash
cloudflared tunnel --url http://localhost:3000
```

In the Meta app → WhatsApp → Configuration, set the **Callback URL** to `https://<tunnel>/webhook`,
the **Verify Token** to your `VERIFY_TOKEN`, and **subscribe to the `messages` field**.

## 🎯 Demo 2 — forward → structured event → Hebrew confirm

1. `pnpm dev` + `cloudflared` tunnel; confirm the webhook verified.
2. From an **allowlisted** phone, forward a real Hebrew gan/scheduling message
   (e.g. `תזכורת: אסיפת הורים מחר ב-18:30 בגן רימון`).
3. You should get back `הוספתי ליומן ✓` with the parsed title + date, and a row in the SQLite DB:

```bash
sqlite3 data/homeos.db "select id, kind, title_he, date_iso, time from events;"
```

Wrong dates/titles are the signal to A/B a stronger model (`ANTHROPIC_MODEL=claude-sonnet-4-6`)
and seed a golden eval set later.

## Tests

```bash
pnpm test           # 45 unit/integration tests, no live network or live Claude calls
pnpm typecheck      # strict TypeScript
pnpm test:cov       # coverage
```

Coverage: config, allowlist, idempotency, Meta payload extraction, Graph API send (mocked `fetch`),
**Claude parsing (mocked client + a real `zodOutputFormat` smoke test)**, **SQLite round-trip
(in-memory)**, handler orchestration (DI), and the routes via Hono `app.request()`. The real
end-to-end is Demo 2.

## Notable implementation choices

- **`node:sqlite`** (Node's built-in driver) instead of `better-sqlite3` + Drizzle — no native build
  step (better-sqlite3 had no Node 24 prebuilt binary). Drizzle can be layered behind `EventStore` later.
- **Zod v4** (`zod/v4`) for the shared schema — required by `@anthropic-ai/sdk`'s `zodOutputFormat`.
- **Haiku 4.5** is the default parsing model (`ANTHROPIC_MODEL`), chosen for cost; swappable per the env.

## Deferred (deliberate scope cuts)

- **Voice notes (M2b)** — Graph media download + local `mlx_whisper` Hebrew STT, then the same parse pipeline.
- **`X-Hub-Signature-256` verification** — add before leaving the test number. Slots into `webhook.ts`.
- **ESLint** — strict `tsc` is the current static gate.

## Deploy (later)

Railway: root directory `platform`, install `pnpm install`, start `pnpm --filter @homeos/server start`.
Set env vars (incl. `ANTHROPIC_API_KEY`) in Railway's dashboard. Note the SQLite file needs a
persistent volume; `dotenv` no-ops when no `.env` file is present.
