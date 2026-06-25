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
| `GET`  | `/oauth/google/status`      | Connection status for the web Connect screen. Bearer `READ_TOKEN`; `{ connected }` (+ `scopes`, `expiresAt` when connected) — never any token material. 503 if Google unconfigured |
| `GET`  | `/oauth/google/connect-url` | Mint the consent URL. Rate-limited per IP; Bearer **`SETUP_TOKEN`** (or `ADMIN_TOKEN`) → `{ url }`. 401 wrong code · 429 too many · 503 dark |
| `GET`  | `/oauth/google/callback`    | Google's redirect target. Validates single-use `state`, pins the account, stores the credential, then **bounces** to the web app (or renders a static Hebrew page) |
| `POST` | `/oauth/google/disconnect`  | Revoke at Google + delete locally + purge derived rows. Bearer `SETUP_TOKEN` (or `ADMIN_TOKEN`) → `{ disconnected: true }`. 503 dark |

> **`WRITE_TOKEN` is a DISTINCT credential from `READ_TOKEN`** (never aliased) so a read-only client
> can't mutate the board — both optional, unset ⇒ that seam returns 503. For local dev set
> `WRITE_TOKEN` (server) **and** `VITE_HOMEOS_WRITE_TOKEN` (web app) to the same string so the AddEvent
> form persists; the web client's `?? READ_TOKEN` fallback is a dev convenience the server does not honor.

## Connect Google (self-serve OAuth, #10)

A family connects their Google account (Calendar + Gmail) themselves from the web **Connections** screen —
no manual token surgery. The OAuth bundle is **all-or-nothing**: set every `GOOGLE_*` var
(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `GOOGLE_TOKEN_ENC_KEY` + `ADMIN_TOKEN`)
or none — none ⇒ the routes ship **dark** (503). Three **optional** self-serve vars ride alongside (each
absent ⇒ admin-only mode, unchanged):

| Var | What | Constraints |
|-----|------|-------------|
| `SETUP_TOKEN` | the bearer the web connect/disconnect flow needs | Generate `openssl rand -base64 32`. Boot-validated: **≥ 32 bytes** of base64 entropy AND **distinct** from `READ_TOKEN` *and* `ADMIN_TOKEN` (a third, independent credential — never aliased). **Never a `VITE_*` var** — it's typed into the web dialog at runtime, never built into the bundle. |
| `WEB_BASE_URL` | where the callback bounces the browser back | Absolute **`https://`** URL whose origin is on the in-code `ALLOWED_WEB_ORIGINS` allowlist (boot-validated, so a misconfigured/attacker-set base URL can't divert the post-consent redirect). |
| `ALLOWED_GOOGLE_EMAIL` | the one Google account the flow accepts | The consenting account's email must match (case-insensitive), else `bad_account`. Unset ⇒ unenforced. |

**Prompt-for-secret UX.** The web app never holds `SETUP_TOKEN`. The Connect dialog prompts for the code,
keeps it in a short-lived in-memory value (cleared on close), sends it as a one-shot bearer, and discards it
— it is never persisted (no `localStorage`/`sessionStorage`) and never bundled. `ADMIN_TOKEN` remains the
curl escape hatch for the same gated routes.

**Dual-mode callback.** When `WEB_BASE_URL` is set, the callback **bounces** the browser to
`${WEB_BASE_URL}/connections?status=<outcome>` — only the server-constructed, allowlisted outcome slug is
forwarded (never `code` / `state` / `error`), with `Referrer-Policy: no-referrer`. When unset, it renders
the original static Hebrew result page (the ships-dark / curl fallback).

**Account-email pin + overwrite guard.** The real write-authorization is Google consent, not the bearer:
after the granted-scope re-check and **before** storing, the callback refuses to silently overwrite a
present credential (→ `bad_account`, disconnect-first) and — when `ALLOWED_GOOGLE_EMAIL` is set — fetches
the consenting account's email (via the Gmail profile endpoint, under the already-granted `gmail.readonly`
scope; **no** extra OIDC/`openid` scope) and requires a match. A fetch failure fails **closed** (stores nothing).

**Phase-8 trip-wire (code-enforced).** Until a real family resolver exists, the only legal family is
`FAMILY_ID === "default"`. The credential store **asserts** this in `upsert` and `issueState`, throwing a
named *single-family* error otherwise — a second family is a loud failure, not a silent unverified-cap /
CASA breach. Crossing it means the identity/session model + the CASA gates (#29/#30) come first.

**Invariants.** Auth is **bearer-only, never a cookie** (no ambient credentials, no CSRF surface). Note a
bearer typed into the browser is visible in React DevTools / the network panel for that session — acceptable
for a single dogfood operator typing a setup code, not a model for real per-user auth (deferred).

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
