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

### Data retention — forwarded text & open threads (#87/G24)

Forwarded message text lands in two places, both bounded by design (data-minimization red line):

- **Board events** (`events`) keep a `source_text` for the parsed item — the durable record the user
  asked us to remember.
- **Open conversation threads** (`conversations`) briefly hold a *draft* of a forwarded message while a
  clarify/cancel/edit question is outstanding. These never accumulate: a thread is **`DELETE`d on
  resolve** (single-use `DELETE … RETURNING`) the moment it's answered, aborted, or redelivered, and an
  unanswered thread is swept by **`expireStale`** — which runs on boot *and* before every inbound — once
  it passes its TTL (`CONVERSATION_TTL_MIN`, default 30 min). So no abandoned draft of third-party
  forwarded text lingers past one short, bounded window. `expireStale` **is** the retention sweep.

## Routes

| Method | Path       | Purpose                                                                |
|--------|------------|------------------------------------------------------------------------|
| `GET`  | `/health`  | Liveness (`{ "status": "ok" }`)                                       |
| `GET`  | `/webhook` | Meta verification handshake — echoes `hub.challenge` if token matches   |
| `POST` | `/webhook` | Inbound messages — **acks 200 immediately**, then parses/persists async |
| `GET`  | `/events`  | Board read seam (the family app). Bearer `READ_TOKEN`; returns `{ events }`. 503 if unset |
| `POST` | `/events`  | Board write seam (web/phone add). Bearer `WRITE_TOKEN`; body = a `ParsedEvent` → the single created `SavedEvent` (201). 503 if unset |

> **`WRITE_TOKEN` is a DISTINCT credential from `READ_TOKEN`** (never aliased) so a read-only client
> can't mutate the board — both optional, unset ⇒ that seam returns 503. For local dev set
> `WRITE_TOKEN` (server) **and** `VITE_HOMEOS_WRITE_TOKEN` (web app) to the same string so the AddEvent
> form persists; the web client's `?? READ_TOKEN` fallback is a dev convenience the server does not honor.

## Module map (foundation-first seams)

```
src/
├── index.ts            composition root — wires config, Claude, store, server
├── config.ts           env parse + fail-fast (zod)
├── http/               transport
│   ├── server.ts        Hono routes; ⚡ ack-then-process
│   └── webhook.ts       Meta verify + payload extraction
├── whatsapp/           the WhatsApp channel
│   └── client.ts        sendText() via Graph API          (M2b: + media.ts)
├── parsing/            Claude extraction
│   └── parser.ts        structured output → ParsedEvent   (M2b: + transcribe.ts)
├── db/                 persistence
│   ├── schema.ts        events table DDL + row type
│   └── event-store.ts   EventStore (node:sqlite)          ← Drizzle layerable behind this iface
└── core/               domain logic + policies (framework-agnostic)
    ├── handler.ts       handleInbound(): parse → persist → confirm
    ├── allowlist.ts     isAllowed()                       🔒 guardrail
    └── idempotency.ts   seen(wa_message_id)               (in-memory, bounded)
```

`test/` mirrors `src/` (e.g. `test/db/event-store.test.ts`). The `ParsedEvent` contract lives in
`@homeos/shared`, so the P1 kitchen display consumes the same shape.

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

> 📋 **Full step-by-step with checkboxes, the Anthropic key, Demo 2, and troubleshooting: [SETUP.md](SETUP.md).** The summary below is the short version.

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
