<!-- Generated 2026-06-17 by the brainstorming --deep workflow (6 research lenses → synthesis → right-sizing
arbiter → security re-pass). The security re-pass found THREE blocker gaps the first threat-model pass
missed (OG14 redirect_uri pinning, OG16 reflected-XSS on the first HTML surface, OG10 programming-error
guard prereq), mirroring how agent-core-plan's re-pass surfaced G15/G16 and the boot-replay bug.
NOTE: this doc was later validated (2026-06-17, BUILD-AFTER-FIXES) and MF1–MF5 folded in — see the
blockquote under the title; in particular OG10 is fixed by guarding parser.ts:75, NOT by editing errors.ts:21. Source issues: #16
(+ #17 Gmail tool / #18 Calendar sync ride the getValidAccessToken seam in §6; #29/#30 are the CASA gate). -->

# Google OAuth Foundation (#16) — Design & Build Plan

> **Validation status — BUILD-AFTER-FIXES (validated 2026-06-17).** A 21-agent workflow upheld all 4
> contested decisions (encrypted-in-SQLite tokens · lean `node:fetch` client · **Production-unverified**
> for dogfooding · `family_id` reserved now) and confirmed **5 must-fix edits, now folded into this doc**:
> - **MF1 (OG10 re-anchor)** — do **NOT** touch `errors.ts:21`. `isTransient` correctly returns `true` for
>   statusless errors (`ECONNRESET`/`ETIMEDOUT` are retryable) and is shared live by `parser.ts:75` +
>   `agent.ts`; flipping it would misclassify every network blip as permanent and silently drop events.
>   The real fix: **extract `isProgrammingError` from `agent.ts` into `errors.ts`** (shared helper) and add
>   it as a guard **before** `isTransient` at `parser.ts:75` — an actual live boot-replay hole. (#57)
> - **MF2** — injectable `now?: () => Date` clock in `issueState`/`consumeState` (via `time.ts:sqliteUtc`);
>   reserve `datetime('now')` for `created_at` only. (#59)
> - **MF3** — the client returns raw `expires_in`; the absolute expiry is computed **once** from the single
>   injected clock at the upsert/refresh sites (unifies the `number`-ms vs SQLite-string type seam). (#59)
> - **MF4** — a tested boot-time guard that `GOOGLE_TOKEN_ENC_KEY` is env-only / never written to the DB, a
>   boot-time key fingerprint/canary (changed key fails loudly, not mass silent degrade), and a bounded
>   backup-retention window so a revoked credential ages out of offsite snapshots. (#58 / #61)
> - **MF5** — reserve the deletion seam **now** (contract only, no purge code in #16): nullable
>   `source_provider TEXT` on `events` + an `EventStore.deleteByProvider(familyId, provider)` stub; #17/#18
>   tag every derived row. (#61)
>
> Build order: **#57** (prereq) → **#58** → **#59** → **#60** → **#61**. Epic: **#16**.

## 1. Decision summary

- **What:** Add a **per-family, opt-in** Google OAuth grant that **ships dark** and is reached only through one new outbound seam, `getValidAccessToken(familyId, deps)`. **No Gmail/Calendar feature lands here** — #16 is *only* the credential lifecycle (consent → encrypted store → refresh-on-demand → revoke) plus the seam #17 (Gmail tool) and #18 (Calendar sync) will call. **Why:** foundation-first — #17/#18 graft onto `getValidAccessToken` with zero rework, exactly as #13's tools grafted onto `callModel` and the flat `tools/` array.
- **The privacy red line is held by construction.** Today HomeOS is forward-only / allowlist-only; Gmail/Calendar is a privacy **expansion**, so the default posture is **off**: with no `GOOGLE_*` env vars, the OAuth client is never constructed, the routes return 503, and **zero Google API calls are possible** — the exact ships-dark contract `READ_TOKEN`/`APP_SECRET` already use (`config.ts:50-52`, `server.ts:51,74`). `main` stays inside the current red line until an operator opts a family in.
- **The one changed seam in the live pipeline is `parser.ts:75`, guarded by a helper extracted into `errors.ts` (MF1).** `parser.ts:75` calls raw `isTransient` with **no** programming-error guard, so a `TypeError`/`RangeError` thrown inside `rawParse` is wrapped `TransientError` → the inbound row stays `pending` → **infinite-boot-replays the queue**. (`agent.ts` is already safe — it guards with `isProgrammingError` before `isTransient`; only the parser call site was missed.) `isTransient` itself is **left unchanged** — it correctly classes statusless `ECONNRESET`/`ETIMEDOUT` as retryable, and it is shared live by both call sites. The fix: **extract `isProgrammingError` from `agent.ts` into `errors.ts`** as a shared exported helper and add it as a pre-check before `isTransient` at `parser.ts:75` (and reserve it for the future Google client call path). This is the agent-core **G10** latent bug at a second, unguarded call site — a **BLOCKER prerequisite** for #16 (#57), shipped as build step 1.
- **Mechanical app-only guarantee, three independent gates (AC3):** (a) **config gate** — no `config.google` ⇒ the OAuth client is never constructed in `index.ts`; (b) **data gate** — no credential row ⇒ `getValidAccessToken` returns *not connected* before any network call; (c) **type gate** — the future tool's dependency is `GoogleClient | undefined`. "ZERO Google API calls in app-only mode" is a **tested invariant** (`oauthClient` `not.toHaveBeenCalled()` — the "callModel not called" analogue), not a code-review promise.
- **Tokens are secrets, treated as secrets (AC1):** AES-256-GCM at rest in a **dedicated `credentials` table** (NOT the EventStore, NOT plaintext config), key from one env var. A decrypt-throw (tampered / wrong / rotated key) **degrades to app-only**, never crashes the pipeline.
- **Minimum scopes, hardcoded server-side (AC2):** `gmail.readonly` + `calendar`, baked as a server constant, never request-derived — and **validated again at use-time** (OG17), since a user can deselect scopes on the consent screen.
- **Right-sized cuts (YAGNI tiebreaker, never overriding a security BLOCKER):** a hand-rolled ~40-line `node:fetch` OAuth client (no `googleapis` / `google-auth-library`); **no PKCE** (confidential client + single-use state row already covers CSRF); no background-refresh cron (refresh on-demand); no key-rotation machinery (one key, the `enc_key_version` column reserved only); no provider abstraction; no admin UI; no separate `OAuthService` orchestrator (the routes file *is* the orchestrator, mirroring `handler.ts`).
- **`ADMIN_TOKEN` is distinct from `READ_TOKEN`** (OG20). `/connect` and `/disconnect` are authenticated **write** surfaces that grant/destroy a family's Gmail access — a higher privilege than the read-only kiosk `GET /events`. A leaked read token must not be able to connect or disconnect a Google account. The cost is one optional ships-dark env var.

## 2. Architecture — four flows, one seam

The inbound pipeline (`webhook → enqueue → handler → agent.run → confirm`) is **byte-identical** to today. #16 adds zero calls into it. Google can only reach the pipeline via a *future* tool (#17/#18), which degrades on `not_connected` and rethrows only `TransientError` — the agent's existing contract.

```
                       ┌──────────────── COMPOSITION ROOT (index.ts) ────────────────┐
                       │  config.google?  ─ undefined ─▶ ships dark: googleDeps NOT built │
                       │                  ─ present  ──▶ build oauthClient + credStore + key │
                       └──────────────────────────────────────────────────────────────┘

CONNECT  (admin, one-time)
  GET /connect/google ──[ADMIN_TOKEN bearer]──▶ issueState(familyId) ──▶ 302 → accounts.google.com/o/oauth2/v2/auth
     (no/bad token → 401 ; config.google undefined → 503)               ?scope=gmail.readonly+calendar
                                                                        &access_type=offline&prompt=consent&state=…

CALLBACK
  GET /oauth/google/callback?code&state ─▶ consumeState(state) ──invalid/reused/expired─▶ 403 (exchangeCode NOT called)
       │  error=access_denied ───────────────────────────────────▶ static Hebrew "cancelled" page (no exchange)
       ▼ state ok
   exchangeCode(code) → GoogleTokens{ refresh? } ──no refresh_token──▶ 400 static Hebrew "retry consent" (nothing stored)
       ▼ refresh_token present, scopes validated (OG17)
   encrypt(refresh)+encrypt(access) → credStore.upsert(familyId,…) ──▶ static Hebrew RTL success page

DISCONNECT  (admin, reversible — AC4 ; MF5 contract = revoke + delete + purge)
  POST /disconnect/google ──[ADMIN_TOKEN]──▶ revoke(refreshToken) ──▶ credStore.delete(familyId) ALWAYS ──▶ deleteByProvider(fam,'google')
                                             (PRIMARY kill-switch:           (revoke 4xx/5xx logged,            (MF5 stub in #16; #17/#18
                                              invalidates the token at        never throws)                     wire the real purge)
                                              Google regardless of backups)                                     └─▶ back to app-only

╔══════════════════ THE SEAM #17/#18 PLUG INTO ═════════════════════════════════════════════════╗
║ getValidAccessToken(familyId, { oauthClient, credentials, now, log })                           ║
║   cred = credentials.get(familyId)                                                              ║
║     └─ null  (no row  OR decrypt threw) ─────────────▶ { status:'not_connected', reason:'absent' }║  ◀── APP-ONLY PATH:
║   !isAccessTokenExpired(cred.expiry, now) ───────────▶ { status:'ok', token }   (ZERO network)  ║      no row ⇒ returns
║   expired:                                                                                      ║      here. ZERO Google
║     oauthClient.refresh(cred.refreshToken)                                                      ║      API calls EVER.
║       ├─ ok ─▶ credentials.updateTokens(...) ──────▶ { status:'ok', token }                     ║
║       ├─ permanent (invalid_grant/revoked/7-day) ─▶ credentials.delete ─▶ {not_connected,'revoked'}║
║       └─ transient (5xx/429) ─▶ THROW TransientError  (caller's existing retry; never poisons)  ║
╚════════════════════════════════════════════════════════════════════════════════════════════════╝
        ▲
        │ (future #17/#18)  tool.run(input, ctx) ─▶ ctx.google?.getAccessToken() ──undefined / not_connected─▶ degrade
        │                   GmailTool / CalendarTool — NOT BUILT HERE; only the ctx.google seam is reserved.
        └──────────────────────────────────────────────────────────────────────────────────────────┘
```

**App-only is provable, not promised.** Three gates must all fail to reach Google: `config.google` must be set (config gate), a credential row must exist (data gate), and `ctx.google` must be defined (type gate). Remove any one and Google is mechanically unreachable.

## 3. Data model + state mechanism + crypto module

### `credentials` table (DDL — mirrors `schema.ts` style; add to `db/schema.ts`)

```sql
CREATE TABLE IF NOT EXISTS credentials (
  family_id           TEXT NOT NULL DEFAULT 'default',
  provider            TEXT NOT NULL DEFAULT 'google',
  enc_refresh_token   TEXT NOT NULL,          -- base64(iv | tag | ciphertext) — the long-lived secret
  enc_access_token    TEXT NOT NULL,          -- base64(iv | tag | ciphertext) — short-lived, refreshed lazily
  access_token_expiry TEXT NOT NULL,          -- SQLite UTC string, lexicographic-comparable vs sqliteUtc(now)
  scopes              TEXT NOT NULL,          -- CSV of GRANTED scopes (validated at use-time, OG17)
  enc_key_version     INTEGER NOT NULL DEFAULT 1,  -- reserved column ONLY; NO rotation code is built (OG12)
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (family_id, provider)           -- per-family isolation (OG9); natural multi-provider key
);
```

- **`family_id` column now, with a `FAMILY_ID = "default"` constant** (in `schema.ts`). This is the deliberate inverse of the usual YAGNI call, on a **migration-asymmetry** argument: adding the column today (table empty, one row ever) is free; adding it at Phase 8 means an `ALTER + backfill over live *encrypted secrets*` plus a uniqueness change — exactly the migration foundation-first exists to avoid. We build the **column + the `WHERE family_id = ?` predicate** (the seam); we build **nothing** that derives a real id (no families table, no resolver, no per-family key) — that is Phase 8.
- **`enc_key_version` column kept; key-rotation code NOT built.** The column is free schema insurance; the rotation machinery, versioned keys, and any external KMS are explicit non-builds (OG12/OG13). Key loss ⇒ re-consent, **never** a plaintext fallback.
- **Single base64 blob `iv|tag|ciphertext`** per secret — one column, not three. 12-byte IV + 16-byte tag prefix, self-framing.

### State mechanism — **SQLite `oauth_state` table** (add to `db/schema.ts`)

```sql
CREATE TABLE IF NOT EXISTS oauth_state (
  state      TEXT PRIMARY KEY,     -- crypto.randomBytes(32) base64url, unguessable
  family_id  TEXT NOT NULL,        -- binds the flow to the initiating family
  expires_at TEXT NOT NULL,        -- SQLite UTC; ~10 min TTL
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Both arbiters split on table-vs-Map; **the table wins** (see §10 RESOLVED-1): state single-use is OG2, a **security control**, and an in-memory Map is silently lost on Railway's redeploy-on-every-push, stripping the control mid-grant. `consume` is an atomic `DELETE ... WHERE state=? AND family_id=? AND expires_at>? RETURNING state` — true single-use with no read-then-delete race, reusing the exact `DELETE … RETURNING` idiom already in `event-store.ts:74-80`. The YAGNI intent is honored by keeping it behind `issueState`/`consumeState` functions **folded into the credential-store module** (no standalone `oauth-state-store.ts`). **Both take an injectable `now?: () => Date` clock (MF2)** — `expires_at` and the `expires_at > ?` comparison are computed via `time.ts:sqliteUtc(now())`, so expiry is fake-clock-testable; `datetime('now')` is reserved for `created_at` only.

### `crypto.ts` (dedicated module — `src/google/crypto.ts`)

```ts
parseKey(b64: string): Buffer                      // → 32 bytes; THROWS at BOOT on wrong length (fail-fast, names the var)
encrypt(plaintext: string, key: Buffer): string    // → base64(iv(12) | tag(16) | ciphertext)
decrypt(blob: string, key: Buffer): string         // THROWS on tamper / wrong key / too-short
```

AES-256-GCM (`node:crypto`, zero new deps), a **fresh 12-byte random IV per call** (OG11 — IV reuse under GCM is catastrophic), 16-byte auth tag verified on decrypt (OG2 — a skipped tag turns GCM into unauthenticated CTR). `CredentialStore.get` wraps `decrypt` in `try/catch` → returns `null` ⇒ degrade; it **never** re-throws into the pipeline. Kept its own module (not inlined) because it is the highest-value security unit-test target and is reused by every future secret — the one place we keep a separate file, the way `errors.ts` earns its own file.

### `CredentialStore` interface (in `src/db/credential-store.ts`, beside `event-store.ts`)

```ts
interface StoredCredential {
  refreshToken: string; accessToken: string; expiry: string; scopes: string[];
}
interface CredentialStore {
  get(familyId: string): StoredCredential | null;          // decrypts; catch-throw → null (degrade to app-only)
  upsert(familyId: string, cred: StoredCredential): void;  // encrypts both tokens (initial consent / re-consent)
  updateTokens(familyId: string, accessToken: string, expiry: string): void;  // refresh path — refresh token untouched
  delete(familyId: string): number;                        // disconnect / revoke / degrade; returns count
}
// folded into the same module, over the same DB handle:
issueState(familyId: string): string                       // crypto.randomBytes(32) base64url, ~10min TTL row
consumeState(state: string, familyId: string): boolean     // atomic DELETE…RETURNING — single-use, expiry-checked
isAccessTokenExpired(expiry: string, now = () => new Date(), skewSeconds = 60): boolean  // pure, injectable clock
```

`createCredentialStore(dbPath, key)` mirrors `createEventStore` exactly: `createRequire("node:sqlite")`, `DatabaseSync`, `PRAGMA journal_mode=WAL`, prepared statements. `provider` is a hard-coded internal constant interpolated into SQL (no injection surface); every external value (`familyId`, blobs, expiry, scopes) is a bound `?` parameter, as in `event-store.ts`.

## 4. Config / env bundle (ships dark) + composition-root wiring

The OAuth env keys are **all-or-nothing**, validated as a group via `superRefine` (a half-configured bundle is a deploy mistake, not a ships-dark intent — fail fast naming the gap, like the empty-allowlist guard in `config.ts:39-40`). When the bundle is absent, `config.google` is `undefined` and the whole feature ships dark.

```ts
// added to the config schema, validated as a group:
GOOGLE_CLIENT_ID,  GOOGLE_CLIENT_SECRET                    // OAuth client (token exchange + revoke)
GOOGLE_REDIRECT_URI    // z.url() — STATIC, exact-match (OG5/OG14); NEVER derived from request headers
GOOGLE_TOKEN_ENC_KEY   // base64 32-byte AES-256-GCM key (OG1); parseKey-validated at boot
ADMIN_TOKEN            // bearer gating /connect + /disconnect — DISTINCT from READ_TOKEN (OG20)
// PUBLIC_BASE_URL?    // optional; boot-time sanity-check that GOOGLE_REDIRECT_URI lives under it
```

```ts
export interface GoogleOAuthSettings {
  clientId: string; clientSecret: string; redirectUri: string; encKey: Buffer; adminToken: string;
}
export interface Config { /* …existing… */ google?: GoogleOAuthSettings; }  // undefined ⇒ ships dark
```

| Var | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth bundle | OAuth client id (Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | OAuth bundle | OAuth client secret (token exchange + revoke) |
| `GOOGLE_REDIRECT_URI` | OAuth bundle | Exact-match callback URL registered in GCC (static, never request-derived — OG14) |
| `GOOGLE_TOKEN_ENC_KEY` | OAuth bundle | 32-byte base64 AES key; `openssl rand -base64 32` |
| `ADMIN_TOKEN` | OAuth bundle | Bearer for `/connect`+`/disconnect` (privileged, distinct from `READ_TOKEN`) |
| `PUBLIC_BASE_URL` | no | Railway public origin; boot sanity-check only |

**Composition root (`index.ts`) — conditional, dark by default:**

```ts
// 🔌 Issue #16: Google OAuth. Built ONLY when the full bundle is configured; otherwise left
// undefined so createServer ships the routes dark (503) — app-only deploys never construct a
// Google client (config gate, OG9a). Mirrors the conditional adminPhone/digest wiring.
const googleDeps = config.google && {
  oauthClient: httpGoogleOAuthClient(config.google),                 // fetch-based; the #17/#18 reuse seam
  credentials: createCredentialStore(config.dbPath, config.google.encKey),  // encKey parseKey'd at boot
  adminToken: config.google.adminToken,
  log,
};
const app = createServer({ /* …existing… */ google: googleDeps });  // routes 503 when googleDeps undefined
```

A malformed `GOOGLE_TOKEN_ENC_KEY` throws in `parseKey` at boot — the feature never silently ships unable to decrypt.

## 5. Routes + GoogleOAuthClient seam + getValidAccessToken contract

### Route table (mounted on `createServer` via `ServerDeps.google?: GoogleOAuthDeps`)

| Method · Path | Guard | Behavior | `config.google` undefined |
|---|---|---|---|
| `GET /connect/google` | `ADMIN_TOKEN` bearer (`timingSafeEqual`) | `issueState(FAMILY_ID)` → 302 to `buildGoogleAuthUrl(state)` (min scopes, `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`) | **503** |
| `GET /oauth/google/callback` | state validated **first** | `error=access_denied` → static Hebrew "cancelled" (no exchange). `consumeState` invalid/reused/expired → **403** (no exchange). Else `exchangeCode` → reject if **no refresh_token** (400) → validate scopes (OG17) → `upsert` → static Hebrew RTL success page | **503** |
| `POST /disconnect/google` | `ADMIN_TOKEN` bearer | `revoke(refreshToken)` — the **PRIMARY kill-switch** (invalidates the token at Google regardless of any backup copy), failure logged + swallowed → `credentials.delete` **ALWAYS** → `deleteByProvider(fam,'google')` (MF5 stub in #16; #17/#18 wire the purge) → Hebrew confirm | **503** |

Routes mount on the existing Hono app (the **routes file is the orchestrator** — no `OAuthService` layer, mirroring `handler.ts`). Bearer checks reuse `bearerMatches` (`server.ts:28-34`) verbatim. **The Hebrew result page is the first HTML surface in the codebase** (`server.ts` is JSON/text only) — it renders a **static** string keyed off an allowlisted enum of `error` values, never interpolating raw query params, with `Content-Type: text/html; charset=utf-8` and `Content-Security-Policy: default-src 'none'` (OG16, BLOCKER — reflected-XSS prevention).

### GoogleOAuthClient seam (hand-rolled `node:fetch`, ~40 lines — `src/google/oauth.ts`)

```ts
interface GoogleOAuthClient {
  exchangeCode(code: string): Promise<GoogleTokens>;    // POST oauth2.googleapis.com/token (authorization_code)
  refresh(refreshToken: string): Promise<GoogleTokens>; // POST …/token (refresh_token) — no new refresh_token in reply
  revoke(token: string): Promise<void>;                 // POST oauth2.googleapis.com/revoke (idempotent: 400→success)
}
httpGoogleOAuthClient(cfg, fetchImpl = fetch)           // injectable fetch — the anthropicCallModel analogue
buildGoogleAuthUrl(cfg, state): string                  // accounts.google.com/o/oauth2/v2/auth + min-scope constant

interface GoogleTokens {
  accessToken: string;
  expiresIn: number;        // RAW seconds from Google's response (MF3) — never hardcode 3600. The client does
                            //   NOT pre-compute an absolute time; the upsert/refresh sites convert it ONCE,
                            //   via the single injected clock → sqliteUtc(now() + (expiresIn-60)s), which is
                            //   also what `access_token_expiry` stores. Unifies the number-ms vs SQLite-string seam.
  refreshToken?: string;    // present only on first consent (prompt=consent forces it)
  scope: string; tokenType: string;
}
// Error classification reuses errors.ts: 5xx/429 → TransientError ; 4xx (incl. invalid_grant) → GoogleOAuthError(code) permanent
```

Lean `node:fetch` (no `googleapis`/`google-auth-library`) is the house pattern — `whatsapp/client.ts` is itself a hand-rolled fetch client. The flow is three form-`POST`s. **What fetch gives up (named honestly):** automatic refresh (we own it in `getValidAccessToken`), a PKCE helper (not needed — confidential client, see §10 RESOLVED-3), id_token/JWT verification (unneeded for this consent flow), and a typed Gmail/Calendar API surface (those become thin fetch wrappers in #17/#18, same as the Graph call). Reconsider `@googleapis/gmail` + `@googleapis/calendar` (the per-API submodules, **not** the monolith) only if #17/#18's call surface gets wide.

### getValidAccessToken — refresh-on-demand contract (the AC5 heart)

Returns a **discriminated status object** (see §10 RESOLVED-5):

```ts
type GetTokenResult = { status: "ok"; token: string }
                    | { status: "not_connected"; reason: "absent" | "revoked" };
```

- **No credential row (or decrypt threw)** → `{ not_connected, 'absent' }`, **ZERO network** (the app-only guarantee; the injected `oauthClient` is `not.toHaveBeenCalled()`).
- **Cached token still valid** (`!isAccessTokenExpired`, 60s skew) → `{ ok, token }`, **ZERO network**.
- **Expired** → `oauthClient.refresh` once → `credentials.updateTokens` → `{ ok, token }`. No consent, no `exchangeCode` (AC5 refresh-without-re-consent).
- **Permanent refresh failure** (`invalid_grant` — revoked, or the 7-day Testing-mode expiry, OG19) → `credentials.delete` (self-heals to app-only) → `{ not_connected, 'revoked' }`. **Never throws.**
- **Transient** (5xx/429) → **rethrow `TransientError`** into the caller's existing retry/boot-replay machinery — never a permanent throw into the pipeline (AC5). The client call path is wrapped by the `isProgrammingError` guard from #57 (MF1) so a programming `TypeError` is classed **permanent** (degrade, surfaced), not retried forever — `isTransient` itself stays unchanged.

## 6. Where the seam meets the agent (reserved, NOT built)

#17/#18 will register a Gmail/Calendar `Tool` on the existing flat `tools/` array (`tools.ts`). The credential is reached through **one new optional field on `ToolContext`**, consistent with the agent-core G8 rule "server-supplied, never model-supplied":

```ts
// FUTURE shape — reserved seam, NO tool ships in #16:
interface ToolContext {
  todayIso: string; from: string; waMessageId: string; senderName?: string;   // existing
  google?: { getAccessToken(): Promise<GetTokenResult> };                       // ← bound from getValidAccessToken(FAMILY_ID, googleDeps)
}
```

- **Type gate (OG9, the third app-only enforcement):** `google` is `… | undefined`. App-only ⇒ `config.google` undefined ⇒ `googleDeps` undefined ⇒ `ctx.google` undefined ⇒ a future tool short-circuits and degrades **before any network reference exists**. Dark mode is impossible to call into by construction.
- The composition root binds `getAccessToken` as a closure `() => getValidAccessToken(FAMILY_ID, googleDeps)` and threads it into the agent's `ToolContext`, exactly as `from`/`todayIso`/`senderName` are threaded today. #16 lands the credential lifecycle + this seam; #17/#18 add only the tool body (`ctx.google?.getAccessToken()` + the Gmail/Calendar call) — **no new pipeline code path**, and every #13 guardrail (G6 re-validate, G8 server-supplied) applies to them for free.

## 7. Guardrails (06/2026) — each as an enforceable mechanism

Two-pass threat model: OG1–OG13 (first pass) confirmed + **OG14–OG20 added by the security re-pass** (the analogue of agent-core's G15/G16). Severity graded BLOCKER / MAJOR / MINOR.

| # | Guardrail | Mechanism (enforcement layer — real file) | Severity |
|---|---|---|---|
| **OG1** | Tokens AES-256-GCM at rest, dedicated `credentials` table, key in env only | `db/crypto.ts` + `db/credential-store.ts`; key from `GOOGLE_TOKEN_ENC_KEY`, never in the DB file. NOT the EventStore, NOT plaintext config. | **BLOCKER** |
| **OG2** | GCM nonce unique per encryption; auth tag verified on decrypt | `crypto.ts`: `randomBytes(12)` per `encrypt`; `decipher.final()` throws on tag mismatch → caught → degrade. Never derive IV from `family_id`/counter. | **BLOCKER** |
| **OG3** | Never log tokens / auth codes / state / enc key | Injected `log(msg, meta)`; OAuth routes + store log only `family_id`, scope names, outcome. Test asserts no `meta` carries token-shaped values. | **BLOCKER** |
| **OG4** | Minimum scopes, hardcoded server-side constant | `buildGoogleAuthUrl` uses a `GOOGLE_SCOPES` const (`gmail.readonly` + `calendar`); never request-derived. | MAJOR |
| **OG5** | Redirect URI exact-match + fixed callback path, no open redirect | One registered URI on Google; the route reads `code`+`state` from query, never an attacker-supplied `redirect`/`next`. | MAJOR |
| **OG6** | (PKCE) — deliberate **non-build** | Confidential client with a kept `client_secret`; single-use family-bound state (OG7) fully covers CSRF. Documented trip-wire in §10/§9. | MINOR (cut) |
| **OG7** | `state`: unguessable, single-use, family-bound, time-limited, atomically consumed before exchange | `oauth_state` row, `randomBytes(32)`, ~10min TTL, `consumeState` = atomic `DELETE…RETURNING` (no replay, no race), validated **before** `exchangeCode`. | **BLOCKER** |
| **OG8** | A Google failure NEVER errors the inbound pipeline | `getValidAccessToken` degrades to `not_connected`; only `TransientError` propagates (caller's existing handling). Depends on OG10. | **BLOCKER** |
| **OG9** | app-only = ZERO Google calls, three mechanical gates | config gate (`index.ts` — client unbuilt), data gate (`credentials.get` → null → return), type gate (`ctx.google` is `… | undefined`). Tested via `not.toHaveBeenCalled()`. | **BLOCKER** |
| **OG10** | Pipeline not poisoned by a programming bug in the Google client | **MF1 (corrected):** extract `isProgrammingError` from `agent.ts` into `errors.ts` and add it as a guard **before** `isTransient` at `parser.ts:75` (and reserve it for the Google call path) — so a statusless `TypeError`/`RangeError` is classed **permanent**. Do **not** touch `errors.ts:21` (`isTransient` is correct for `ECONNRESET`/`ETIMEDOUT` and shared live by both call sites). Else infinite boot-replay. **Hard prerequisite (#57).** | **BLOCKER** |
| **OG11** | IV reuse / unauthenticated ciphertext prevented | `crypto.ts` AEAD: fresh `randomBytes(12)` IV every write, blob `iv|tag|ciphertext`. Test asserts two encrypts of the same plaintext differ. | MAJOR |
| **OG12** | Key rotation reserved, key loss = re-consent, no plaintext fallback | `enc_key_version` column reserved; **no** rotation code. Decrypt-throw → `null` → re-consent. Documented in the store header. | MINOR |
| **OG13** | No external KMS — env-var key is right-sized | `GOOGLE_TOKEN_ENC_KEY` in Railway env, period. No AWS/GCP KMS / Vault (paid dep + latency for one family). | MINOR |
| **OG14** | `redirect_uri` is fixed config, NOT built from request headers | Behind the Railway proxy `Host`/`X-Forwarded-*` are spoofable; deriving the URL = open-redirect + Google `redirect_uri_mismatch`. Pin to `GOOGLE_REDIRECT_URI`. Same "don't trust proxy headers" discipline as `webhook.ts`'s raw-body HMAC. | **BLOCKER** |
| **OG15** | Rate-limit / bound `/connect` + `/callback` | Unbounded state-row issuance + Google `exchangeCode` is the OAuth analogue of agent-core G16. Reuse the `MAX_PER_SENDER_PER_DAY` config pattern; TTL-evict the `oauth_state` table (purge expired on `issueState`). | MAJOR |
| **OG16** | Escape/allowlist the `error` param on the HTML result page (reflected XSS) | The Hebrew result page is the **first HTML surface in the codebase**. Render a static string from an allowlisted `error` enum; never interpolate raw query. `Content-Type: text/html; charset=utf-8` + CSP `default-src 'none'`. | **BLOCKER** |
| **OG17** | Validate granted scopes at USE time, not only request time | A user can deselect scopes on the consent screen → Google returns fewer. On callback/store, assert the returned `scope` set matches expected; reject + degrade on a broader/unexpected scope. | MAJOR |
| **OG18** | Oversized callback-param DoS guard | Cap `code`/`state`/`error` length before processing (`state` is a known ~43-char base64url). Fail-fast, mirrors agent-core G2 input cap. | MINOR |
| **OG19** | The 7-day Testing-mode refresh expiry degrades gracefully | A dead refresh token → `refresh()` 400 `invalid_grant` → **permanent** (once OG10 fixed) → delete + `not_connected` + quiet Hebrew reconnect prompt; **never** a `TransientError`, never a pipeline error. Test asserts a 400 `invalid_grant` is NOT classed transient. | MAJOR |
| **OG20** | `/connect` + `/disconnect` gated by a dedicated `ADMIN_TOKEN`, not `READ_TOKEN` | These grant/destroy Gmail access — higher privilege than the read-only kiosk. Distinct env, same `timingSafeEqual` `bearerMatches`, same `undefined → 503` ships-dark. | MAJOR |

**Severity rollup.** BLOCKERS (must ship in #16): OG1, OG2, OG3, OG7, OG8, OG9, OG10, OG14, OG16. MAJORS: OG4, OG5, OG11, OG15, OG17, OG19, OG20. MINORS: OG12, OG13, OG18; OG6 is a documented cut.

## 8. File plan

| Path | Change | Purpose |
|---|---|---|
| `platform/apps/server/src/core/errors.ts` | **modified (MF1)** | **Extract** `isProgrammingError` from `agent.ts` into `errors.ts` as a shared exported helper. **`isTransient` (`:21`) is left unchanged.** |
| `platform/apps/server/src/parsing/parser.ts` | **modified (the one live-pipeline seam, MF1)** | Add the `isProgrammingError(err)` pre-check **before** `isTransient` at `:75` — closes the infinite-boot-replay latent bug at the unguarded parser call site (OG10/G10). Ship #16 only on top of this. |
| `platform/apps/server/src/google/crypto.ts` | **new** | `parseKey` / `encrypt` / `decrypt` (AES-256-GCM, single base64 `iv|tag|ct` blob). Security-critical, isolated, fully tested. |
| `platform/apps/server/src/google/oauth.ts` | **new** | `buildGoogleAuthUrl` + `httpGoogleOAuthClient` (`exchangeCode`/`refresh`/`revoke`) + `getValidAccessToken` + `GoogleTokens`/`GoogleOAuthError`. The whole Google OAuth surface in one file (the #17/#18 reuse seam). |
| `platform/apps/server/src/db/credential-store.ts` | **new** | `createCredentialStore` (`credentials` + `oauth_state` DDL exec, prepared stmts, `consumeState` via `DELETE…RETURNING`) + `issueState`/`consumeState`/`isAccessTokenExpired`. Beside `event-store.ts`; mirrors it. |
| `platform/apps/server/src/http/oauth-routes.ts` | **new** | The 3 routes (connect / callback / disconnect); routes-as-orchestrator; static Hebrew RTL result pages (OG16). |
| `platform/apps/server/src/db/schema.ts` | **modified** | Add `CREATE_CREDENTIALS_TABLE` + `CREATE_OAUTH_STATE_TABLE` + `CredentialRow`/`OAuthStateRow` + `FAMILY_ID = "default"`. |
| `platform/apps/server/src/config.ts` | **modified** | Google env bundle (`superRefine`, all-or-nothing) → `config.google?`; `parseKey` at boot; `ADMIN_TOKEN`. |
| `platform/apps/server/src/http/server.ts` | **modified** | `ServerDeps.google?: GoogleOAuthDeps`; mount oauth-routes; 503 when undefined (mirrors `GET /events`). |
| `platform/apps/server/src/index.ts` | **modified** | Conditionally build `googleDeps`; pass into `createServer`. Inbound-pipeline wiring untouched. |
| `platform/apps/server/src/db/event-store.ts` (+ `EventStore` interface) | **modified (MF5)** | Add nullable `source_provider TEXT` to the `events` DDL + a `deleteByProvider(familyId, provider)` **stub** (contract only, no purge caller in #16). Reserves the reversibility seam #17/#18 consume. |
| `platform/apps/server/src/infra/backup.ts` | **modified (MF4)** | Boot-time guard that `GOOGLE_TOKEN_ENC_KEY` is env-only / never written to the DB file; a **bounded backup-retention window** so a revoked credential ages out of offsite snapshots (AC4 holds for the backup corpus, not just the live row). |
| `platform/apps/server/test/google/crypto.test.ts` | **new** | Round-trip (+ Hebrew), tamper→throw, wrong-key→throw, IV-uniqueness, `parseKey` wrong-length→throw. |
| `platform/apps/server/test/db/credential-store.test.ts` | **new** | Encrypted-at-rest (raw row ≠ plaintext), get/upsert/updateTokens/delete round-trip, get(unknown)→null, corrupt-blob→null (degrade), state CSRF (valid once / forged / reused / expired). |
| `platform/apps/server/test/google/oauth.test.ts` | **new** | One mocked-`fetch` request-shape test (URL/method/`Content-Type`/form body — the `anthropicCallModel` analogue) + error classification; `getValidAccessToken` fake-clock matrix. |
| `platform/apps/server/test/http/oauth-routes.test.ts` | **new** | `app.request`: 503 dark; `/connect` 302 + min scopes + params; callback happy/denied/bad-state; disconnect revoke+delete; XSS-escape of `error` param (OG16). |
| `platform/apps/server/test/core/errors.test.ts` | **modified (MF1)** | Assert a statusless `TypeError` → `isProgrammingError` **true**; a statusless `ECONNRESET` → `isProgrammingError` **false** / `isTransient` **true** (unchanged). Plus a parser-call-site test: a programming error at `parser.ts:75` does **not** boot-replay. |

**File-count note (RESOLVED-2):** 5 new source files (+ the `errors.ts` edit). `getValidAccessToken` lives **in `google/oauth.ts`** with the rest of the Google surface rather than a separate `token-service.ts` — it is the *body* of the OAuth surface, not a parallel API, the way `agent.ts` carries the whole bounded loop in one file with a fat test suite. Test weight justifies test files, not source files. Split it out only if the refresh logic grows a second distinct responsibility.

## 9. Test plan — injected-seam, fake-clock, no live calls

**Product-guarantee tests (lock the acceptance criteria):**
1. **App-only makes ZERO Google calls (AC3 — THE guarantee):** `getValidAccessToken(fam)` with no credential → `{ not_connected, 'absent' }` and a `vi.fn()` `oauthClient` (`exchangeCode`/`refresh`/`revoke`) is `not.toHaveBeenCalled()`. The "callModel not called" analogue.
2. **Ships-dark routes (AC3):** `GOOGLE_*` unset → `app.request("/connect/google")` → **503**; no Google client constructed.
3. **Credential stored encrypted, not plaintext (AC1):** after `upsert`, read the **raw SQLite row** — `enc_*` columns do not contain the plaintext token substring; `get` round-trips the plaintext; the store is not the EventStore.
4. **Connect/disconnect reversible (AC4):** disconnect calls `revoke(token)` **then** `delete`; subsequent `get` → null and `getValidAccessToken` → `not_connected` with no client call.
5. **Refresh without re-consent (AC5):** fake clock past expiry → `refresh` once, `updateTokens` persists new token+expiry, returns the new token — **no `exchangeCode`, no consent redirect**.

**Crypto (`crypto.test.ts`):** round-trip incl. Hebrew + long tokens; tamper (flip one byte) → throw; wrong-key → throw; IV-uniqueness (two encrypts differ, both decrypt); `parseKey` wrong-length → throw.

**Store + state/CSRF (`credential-store.test.ts`, `:memory:`):** upsert/get/updateTokens/delete; get(unknown)→null; corrupt-blob→null (degrade, no throw); state valid→consumed once, forged→false, reused→false (single-use), expired→false (fake `now`). *Test-harness note:* `:memory:` is per-connection, so the wrong-key/rotation case uses a temp-file path or inserts a deliberately corrupt blob.

**OAuth client + refresh (`oauth.test.ts`):** one **mocked-`fetch`** request-shape test (token URL, `POST`, `application/x-www-form-urlencoded`, body has `grant_type`/`code`/`client_id`/`client_secret`/`redirect_uri`); 5xx→`TransientError`, 4xx `invalid_grant`→permanent (`GoogleOAuthError`); `buildGoogleAuthUrl` asserts the exact min-scope string + `access_type=offline`+`prompt=consent`. `getValidAccessToken` fake-clock: valid→as-is (no call), expired→refresh+update, **revoked→delete+not_connected+no-throw** (AC5/OG19), transient→rethrow `TransientError`+stays-connected.

**Routes (`oauth-routes.test.ts`, `app.request`):** 503 dark; `/connect` 302 with min scopes + `state`; callback happy stores encrypted; callback `error=access_denied` → graceful, **`exchangeCode` NOT called**; callback bad/expired/reused state → 403, **`exchangeCode` NOT called**; disconnect → revoke+delete; **a hostile `?error=<script>` is escaped/allowlisted, not reflected** (OG16).

**errors.ts (`errors.test.ts`, MF1):** a statusless `TypeError` → `isProgrammingError` **true** (the guard classes it permanent); a statusless network error (`ECONNRESET`) → `isProgrammingError` **false** and `isTransient` stays **true** (retryable, unchanged). The combined effect: `parser.ts:75` drops a programming bug to permanent while still retrying network blips (OG10).

**Gate:** `pnpm typecheck` (strict) + `pnpm test` green; **no network**, `:memory:` only; the one `fetch`-shape test is the sole place a Google request body is built and `fetch` is mocked.

## 10. Build order — small TDD steps (red→green), each shippable

1. **`isProgrammingError` guard first (OG10 / MF1 / #57).** Red: a `TypeError` thrown at the `parser.ts:75` call site currently boot-replays (wrapped `TransientError`); assert it is classed **permanent** and a `ECONNRESET` still retries. Green: extract `isProgrammingError` into `errors.ts`, guard `parser.ts:75` — **leave `isTransient` untouched**. *Closes the live boot-replay BLOCKER before any Google code exists; ships on its own.*
2. **`crypto.ts` (the trust root).** Red: round-trip (+ Hebrew), tamper→throw, wrong-key→throw, IV-uniqueness, `parseKey` wrong-length→throw. Green: AES-256-GCM module. *Shippable: a reusable secret-at-rest primitive, zero pipeline change.*
3. **Config + schema (ships dark).** Red: no Google env → `config.google` undefined; partial bundle → `superRefine` error; the two DDL strings create valid `:memory:` tables. Green: env group + `parseKey` at boot + DDL + `FAMILY_ID`. *Shippable: app-only behavior unchanged, nothing mounted.*
4. **`createCredentialStore`.** Red: raw `enc_*` columns ≠ plaintext (AC1); get/upsert/updateTokens round-trip; corrupt-blob→null (degrade); `delete` returns count. Green: store.
5. **State (folded, MF2).** Red: valid→consumed once; forged→false; reused→false (single-use via `DELETE…RETURNING`); expired→false via the **injected `now`** (not `datetime('now')`). Green: `issueState`/`consumeState` + TTL purge.
6. **`oauth.ts` client + auth URL (MF3).** Red: one mocked-`fetch` request-shape test (exchange/refresh/revoke) returning raw `expires_in` + 5xx→`TransientError`/4xx→permanent; `buildGoogleAuthUrl` min-scope + params. Green: fetch client reusing `errors.ts` classification; the absolute expiry is computed **once** at the upsert/refresh sites from the injected clock, never inside the client.
7. **`getValidAccessToken` — the app-only-zero-call test FIRST.** Red: no credential → `not_connected` AND `oauthClient` `not.toHaveBeenCalled()` (AC3, THE guarantee). Then fake-clock: valid→no-call, expired→refresh+update (AC5), revoked→delete+`not_connected`+no-throw (AC4/AC5/OG19), transient→rethrow. Green: the function. *Shippable: AC3+AC5 locked behind a seam; pipeline untouched.*
8. **`oauth-routes.ts`.** Red via `app.request`: 503 dark (AC3); `/connect` 302 + min scopes; callback happy/denied/bad-state (exchange NOT called on the latter two); disconnect revoke+delete (AC4); hostile `?error` escaped (OG16). Green: routes + static Hebrew result pages.
9. **Composition root.** `index.ts` conditional `googleDeps`; `ServerDeps.google?` mount + 503 guard in `server.ts`. `pnpm dev` smoke (dark + connected); existing `server.test.ts` stays green.
10. **Reversibility & deletion seam (#61, MF4 + MF5).** Red: a `deleteByProvider(fam, 'google')` stub exists and is callable (no purge caller yet); the `events` DDL carries nullable `source_provider`; a boot-time test asserts `GOOGLE_TOKEN_ENC_KEY` is **not** present in the DB file; backup retention is bounded (revoked credential ages out). Green: `source_provider` column + `deleteByProvider` stub + `infra/backup.ts` env-key guard + retention window. *Contract only — #17/#18 add the purge callers.*
11. **Gate.** `pnpm typecheck && pnpm test` green; confirm no socket opens and `:memory:` only (temp-file path for the wrong-key crypto case).

## 11. Resolved contradictions (the synthesis decisions)

The tiebreaker was foundation-first / right-sized — **never** overriding a security BLOCKER.

- **RESOLVED-1 — `oauth_state`: SQLite table, not an in-memory Map.** State single-use is OG7, a security control; a Map is silently lost on Railway's redeploy-on-every-push (stripping the control mid-grant) and can't do atomic single-use across processes. The table is ~30 lines reusing the existing `DELETE…RETURNING` idiom — within right-sized. YAGNI intent honored by folding `issueState`/`consumeState` into the credential-store module (no standalone state-store file).
- **RESOLVED-2 — 5 source files, `getValidAccessToken` in `google/oauth.ts`.** The "two future consumers (#17/#18)" argument justifies a clean *exported function*, not a separate file — exactly how #13 held the seam (the `Tool` export) without a `registry.ts`. The store lives in `src/db/` (the house's unambiguous home for node:sqlite stores). Dropped: `oauth-state-store.ts`, `types.ts`, `OAuthService`.
- **RESOLVED-3 — No PKCE (documented non-build).** Confidential server client holding `client_secret`; the code exchange is already secret-authenticated and CSRF is covered by the single-use family-bound state row. PKCE protects *public* clients that can't keep a secret — inert here. Trip-wire: add it if a public/native client is ever introduced.
- **RESOLVED-4 — distinct `ADMIN_TOKEN` (overruled the "reuse READ_TOKEN" arbiter).** This is a privacy-line expansion; the security re-pass graded reusing the kiosk read token to grant/destroy Gmail access as MAJOR (OG20). One optional ships-dark env var is the cheap, correct trade. Trip-wire if ever reconsidered: a leaked read token must never start an OAuth grant.
- **RESOLVED-5 — `getValidAccessToken` returns a discriminated `{status}` object, not `string|null`.** It is the load-bearing AC5 contract with two real consumers; `null` collapses never-connected / just-revoked / refresh-failed into one ambiguous value, inviting a thrown error or a silent-wrong-branch. The status object makes "not connected" a value the caller must handle — the agent's "degrade, never throw" philosophy made explicit. `reason` lets #17/#18 choose silent-skip vs a Hebrew reconnect nudge.

## 12. Risks & open questions

- **Testing-mode 7-day refresh-token expiry (operational, real).** In Google's **Testing** publishing status, refresh tokens **expire after 7 days** (unless basic-identity-only scopes), breaking unattended polling and forcing weekly re-consent. #16's graceful-degrade path (expired/revoked → app-only + quiet Hebrew reconnect, OG19) handles the worst case. Mitigation to avoid weekly friction: move the consent screen to **Production publishing status while staying *unverified*** (non-expiring refresh tokens; the only cost is the "unverified app" warning on the consent screen — acceptable for a single known family). Confirm this is acceptable for dogfooding.
- **`gmail.readonly` is a RESTRICTED scope ⇒ CASA security assessment (~$500–$1,800/yr, annual) to publish broadly** — a money + time gate tracked as **#29/#30**. Calendar scopes are SENSITIVE only (verification, no CASA). **Not a #16 blocker:** single-family + unverified-but-Production avoids CASA now. Before any "go public" / multi-family (Phase 8) move: CASA passed + dated, a published privacy policy covering Gmail/Calendar data + deletion (the `/disconnect` always-local-delete is the mechanism), `redirect_uri` allowlist locked to the production domain (OG14), and `GOOGLE_TOKEN_ENC_KEY` confirmed env-only / absent from DB backups (OG1). The ≤$100/mo budget needs revisiting at that gate.
- **`refresh_token` returned on first consent only.** `prompt=consent` forces it on every grant; the callback **rejects a token response with no refresh_token** (stores nothing) so we never persist an unrefreshable credential.
- **`FAMILY_ID = "default"` is a constant, not yet a real identity source.** Named explicitly so OG9 isn't hand-wavy. Phase 8 swaps the constant for a resolved id; the `(family_id, provider)` PK and `WHERE family_id=?` queries are already isolation-ready — no migration.
- **The Hebrew result page is the first HTML rendering in the codebase.** OG16 (static, allowlisted-enum, CSP) is a functional requirement, not a nicety — the codebase has no prior HTML-escaping precedent to lean on.
- **Reversibility spans three surfaces, not one (MF4 + MF5, #61).** "Disconnect returns the family to app-only" (AC4) is only fully true once: (a) `revoke()` is treated as the **primary** kill-switch (it invalidates the token at Google even for copies already in offsite backups); (b) the nightly `infra/backup.ts` corpus can't out-live a revocation — hence a **bounded backup-retention window** + a tested guard that `GOOGLE_TOKEN_ENC_KEY` is never written into the DB file (MF4); and (c) the derived-row **purge seam exists** — nullable `source_provider` + `deleteByProvider` stub reserved in #16, with #17/#18 wiring the actual purge (MF5). **The "privacy-policy deletion mechanism" claim therefore holds only once the derived-row purge is wired** — #16 reserves the contract; it does not yet delete derived rows (none exist until #17/#18).
- **Key rotation, external KMS, multi-provider abstraction, admin UI, dynamic/incremental scopes, background-refresh cron — explicit non-builds (OG12/OG13/§10).** The `enc_key_version` column reserves the schema; nothing more is pre-paid. Key loss ⇒ re-consent, never a plaintext fallback.
- **Security re-pass verdict: NOT "no blocker gap."** The first threat-model pass (OG1–OG13) under-graded three items the re-pass elevated to BLOCKER: **OG10** (programming-error guard prereq — MF1: guard `parser.ts:75`, not `errors.ts:21`), **OG14** (request-header `redirect_uri`), **OG16** (reflected XSS on the new HTML surface). With those folded in, the remainder is MAJOR/MINOR hardening that fits existing seams (`config.ts` env pattern, `server.ts` `bearerMatches`/503, the extracted `isProgrammingError` guard).
