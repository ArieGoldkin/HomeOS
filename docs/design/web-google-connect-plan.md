<!-- Generated 2026-06-19 by the web-google-connect-design workflow (9 agents): investigate(5) → synthesize →
adversarial critique (security + over-engineering) → finalize. Builds on docs/design/google-oauth-plan.md (#16).
Locked scope: self-serve web 'Connect Google' (calendar/gmail CONNECT UX), reuse the #16 credential lifecycle,
no user/identity model. -->

# Self-Serve Web "Connect Google" — Design (Phase 6, builds on OAuth #16)

> Companion to `docs/design/google-oauth-plan.md`. This document changes ONLY the
> *initiation* of the Google connect flow and adds a web UX + an auth gate for it.
> The credential lifecycle (state / exchange / encrypt / upsert / refresh-on-demand)
> from #16 is reused verbatim. Ships-dark, Hebrew-first/RTL, Asia/Jerusalem.

## 1. Decision summary

Today the family Google account is connected by an operator who (a) holds `ADMIN_TOKEN`,
(b) manually hits `GET /connect/google` with a bearer header, and (c) follows the 302 to
Google. A browser cannot send a bearer header on a top-level navigation, so this was a
curl-only, fiddly flow — the reason the live prod test was painful.

**Decision:** add a one-click web button on a new `features/connections` screen that grants
the **same hardcoded scopes** (`gmail.readonly` + `calendar`) and stores the credential via
the **existing machinery**. The new pieces are:

1. **A dedicated `SETUP_TOKEN`** (server-only env, NOT a `VITE_*` bundle var) delivered by a
   **prompt-for-secret dialog** (Synology/Plex style): the family types it at click time; it
   lives only in React component state for the dialog lifetime.
2. **`GET /oauth/google/connect-url`** returns JSON `{ url }` (not a 302) so a `fetch` carrying
   the bearer can hand the URL to `window.location.assign`. This is the exact gap that made the
   admin flow fiddly.
3. **An account-identity pin (`ALLOWED_GOOGLE_EMAIL`) at the callback** — the actual
   write-authorization the token gate cannot provide (closes OAuth account-mixup hijack).
4. **The existing `GET /oauth/google/callback` is reused byte-for-byte**, with a single new
   terminal branch: bounce to the web app when `WEB_BASE_URL` is set, else render the existing
   static Hebrew page (ships-dark / curl fallback).

**Scope guardrails (from the over-engineering lens):** ONE gate function that accepts EITHER
`ADMIN_TOKEN` OR `SETUP_TOKEN` on the new route set — we do **not** mount six parallel routes.
We do **not** add `CredentialStore.has()` (one AES-GCM decrypt for one family is free). No
user/identity model, no RBAC, no sessions/cookies, no PKCE (still a confidential server-side
client). `FAMILY_ID === 'default'` is hard-asserted in code so a second family is a loud failure,
not a silent compliance breach.

## 2. Architecture

### 2.1 End-to-end web connect (reuses the #16 callback)

```
WEB (features/connections)            SERVER (@homeos/server)          GOOGLE
──────────────────────────            ───────────────────────         ──────
[Connect Google] click
  └─ Radix dialog: type SETUP_TOKEN (component state only)
       │  GET /oauth/google/connect-url
       │  Authorization: Bearer <typed SETUP_TOKEN>
       ▼
                                   gateMatches(setup|admin)  ◄── BEFORE any work
                                   issueState(default)       (verbatim #16)
                                   buildGoogleAuthUrl()      (verbatim #16)
                                   200 { url }
  window.location.assign(url) ─────────────────────────────────────►  consent
                                                                       (offline,
                                                                        prompt=consent,
                                                                        gmail.readonly+calendar)
                                                              ◄────────  302 to PINNED
                                                                         GOOGLE_REDIRECT_URI
                                   GET /oauth/google/callback?code&state
                                   consumeState (single-use CSRF, verbatim)
                                   exchangeCode (verbatim)
                                   no-refresh guard (verbatim)
                                   OG17 scope re-validation (verbatim)
                                   ── NEW: userinfo email === ALLOWED_GOOGLE_EMAIL ?
                                   ── NEW: refuse silent overwrite of a present row
                                   MF3 expiry + credentials.upsert(default) (verbatim)
                                   ── terminal: WEB_BASE_URL set?
                                        yes → 302 ${WEB_BASE_URL}/connections?status=connected
                                              (Referrer-Policy: no-referrer)
                                        no  → static Hebrew page() (ships-dark fallback)
  /connections reads ?status=, maps via shared Outcome enum → Hebrew banner,
  strips param, invalidates ['google','status']
       ▼
  GET /oauth/google/status  Authorization: Bearer <READ_TOKEN>   ◄── non-secret payload
                                   { connected, scopes?, expiresAt? }  (OG20-consistent)
       ▼
  Card flips to CONNECTED.  Bot's getValidAccessToken / 'סנכרן יומן' /
  calendar auto-push now work with ZERO pipeline change.
```

### 2.2 Reused verbatim vs new

**Verbatim from #16 (not a line changes):**
`issueState` / `consumeState` (single-use family-bound atomic `DELETE...RETURNING` CSRF);
`buildGoogleAuthUrl` + the hardcoded `GOOGLE_SCOPES` const (`access_type=offline`,
`prompt=consent`); the entire callback body up to upsert (state-first, `exchangeCode`,
no-refresh guard, OG17 scope re-validation, MF3 expiry, `upsert`); `exchangeCode`/`refresh`/
`revoke` in `httpGoogleOAuthClient`; AES-256-GCM crypto + `credentials` table + boot key-canary;
`getValidAccessToken` refresh-on-demand seam (the bot reads `credentials.get`, unaware of how the
row was minted); `redirect_uri` pinning (OG14); `bearerMatches`/`timingSafeEqual`; the static
Hebrew `page()` + `Outcome` enum + CSP `default-src 'none'` (kept as the ships-dark fallback); the
three-gate ships-dark invariant; the disconnect body (revoke + delete + `deleteByProvider`).

**New (the only additions):**
1. `SETUP_TOKEN` (optional) + `WEB_BASE_URL` (optional) + `ALLOWED_GOOGLE_EMAIL` (optional)
   folded into the all-or-nothing Google bundle in `config.ts`.
2. `gateMatches(header, deps)` — accepts EITHER `ADMIN_TOKEN` OR `SETUP_TOKEN` (constant-time).
3. New route set under the shared `/oauth/google/*` prefix: `GET /oauth/google/connect-url`
   (JSON `{ url }`), `GET /oauth/google/status` (READ_TOKEN-gated), `POST /oauth/google/disconnect`
   (gate; shares the existing disconnect body). The legacy `GET /connect/google` +
   `POST /disconnect/google` are **dropped** once the web flow lands (curl escape hatch survives
   via `gateMatches` accepting `ADMIN_TOKEN` on the new routes).
4. Callback: account-email pin + overwrite-guard + WEB_BASE_URL bounce branch.
5. A minimal per-IP rate limiter on the gated routes + callback (the synthesis cited OG15 as if it
   existed; it does not — we implement it).
6. Web: `features/connections` slice + `shared/api/google.ts` + `use-connection-status` hook +
   a zod `connectionStatusSchema` and a shared `Outcome` enum in `@homeos/shared`.

## 3. The self-serve auth gate

### 3.1 Chosen mechanism

A dedicated, **server-only `SETUP_TOKEN`** env var, distinct from both `ADMIN_TOKEN` and
`READ_TOKEN`, delivered via a **prompt-for-secret form** (typed at click time, sent as the bearer
only on the write calls, discarded on dialog close). The gate is `gateMatches` = constant-time
`bearerMatches` against `SETUP_TOKEN` **OR** `ADMIN_TOKEN`. Boot enforces `SETUP_TOKEN` is high
entropy (≥ 32 bytes base64) and differs from `READ_TOKEN`/`ADMIN_TOKEN`.

**Read split (refined per SECURITY blocker 2):** `GET /oauth/google/status` is gated by the
**`READ_TOKEN`**, not `SETUP_TOKEN`. Its payload (`{ connected, scopes?, expiresAt? }`) is entirely
non-secret and has zero write power — exactly the kind of board-level read `READ_TOKEN` already
governs (OG20). This keeps the **privileged `SETUP_TOKEN` off the always-on kitchen tablet's
polling path** (`staleTime 30s`, `refetchOnWindowFocus`). `SETUP_TOKEN` is reserved strictly for
`connect-url` + `disconnect`, typed on the dev's phone.

### 3.2 Why not the others

- **Reuse `READ_TOKEN` as the write gate — REJECTED.** It is inlined into the static Vite bundle
  (`vite-env.d.ts` literally says "not real auth"). OG20/RESOLVED-4 set a trip-wire that a leaked
  read token must never start a grant or disconnect; reusing it collapses the read-vs-write split
  #16 built. (READ_TOKEN gating the *non-secret status read* is fine and is exactly what it is for.)
- **Any `VITE_HOMEOS_SETUP_TOKEN` — REJECTED.** A privileged secret compiled into world-readable JS
  makes the gate cosmetic.
- **Cookie/session — REJECTED.** Overkill for one family; reintroduces SameSite/CSRF concerns the
  bearer-only choice sidesteps if the SPA and API are on different origins.
- **One-time setup link — REJECTED.** More moving parts (link minting/TTL/storage) than a typed code
  for one admin.

### 3.3 Threat model (single-family dogfood, FAMILY_ID='default', one admin)

| # | Threat | Control |
|---|--------|---------|
| 1 | Bundle inspection leaks the gate | `SETUP_TOKEN` never compiled in; held in component state only. |
| 2 | Internet probe of `connect-url` floods `oauth_state` | `gateMatches` runs **before** `issueState` → unauth hit 401s, mints NO state row (OG15/OG18). |
| 3 | Online brute force of the token | `timingSafeEqual` + ≥32-byte entropy (boot-enforced) + per-IP rate limiter (429 + fixed mismatch delay). |
| 4 | CSRF on the OAuth round-trip | Single-use, family-bound `state` row (OG7), verbatim; a cross-origin form cannot set an `Authorization` header. |
| 5 | **Account-mixup / login-CSRF hijack** (attacker tricks the family into completing consent on an attacker-initiated state, swapping the connected account) | **NEW:** at the callback, `userinfo.email === ALLOWED_GOOGLE_EMAIL` before upsert; upsert refuses to silently overwrite a present row. The token gate is NOT the write boundary — Google consent is — so identity must be pinned. |
| 6 | Disconnect abuse | Intentional self-serve; `revoke()` at Google is the primary kill-switch regardless of token holder. |
| 7 | Open-redirect / Referer leak on the web bounce | **NEW:** `WEB_BASE_URL` boot-validated as an absolute `https://` URL on an explicit allowlist; bounce built by hand from constant base + allowlisted slug; `Referrer-Policy: no-referrer`; never forward `c.req.query()`. |
| 8 | Transport / logging | HTTPS-only (Railway TLS); `SETUP_TOKEN` never logged (OG3). |
| 9 | Shoulder-surfing | Connect from the dev's phone, not the kiosk; status is READ_TOKEN-only so the tablet never sees `SETUP_TOKEN`. |

## 4. Server endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/oauth/google/callback` | none (single-use state + **NEW email pin**) | Reused byte-for-byte through upsert. NEW: `userinfo.email===ALLOWED_GOOGLE_EMAIL` + overwrite-guard + WEB_BASE_URL bounce (else static Hebrew `page()`). |
| GET | `/oauth/google/connect-url` | `gateMatches` (SETUP_TOKEN or ADMIN_TOKEN) | `gateMatches` **before** `issueState`; `issueState(default)` + `buildGoogleAuthUrl`; returns JSON `{ url }` for `window.location.assign`. 401 / 503 dark / 429 rate-limited. |
| GET | `/oauth/google/status` | `READ_TOKEN` | Connection-status for the card. Returns `{ connected, scopes?, expiresAt? }` from `credentials.get`. NEVER returns token/refresh/enc-key (OG3). 503 dark. |
| POST | `/oauth/google/disconnect` | `gateMatches` (SETUP_TOKEN or ADMIN_TOKEN) | Shares the existing disconnect body (revoke + delete + `deleteByProvider`). Returns JSON `{ disconnected: true }`. 401 / 503 dark. |

Legacy `GET /connect/google` and `POST /disconnect/google` are **removed** (the over-engineering
lens flagged the double surface; the curl escape hatch survives because `gateMatches` accepts
`ADMIN_TOKEN`). `/oauth/google/*` is the single prefix so all Google surfaces are easy to
ships-dark, CORS-allowlist, and grep (the redirect_uri-pinned callback already lives there).

## 5. Web UX (`features/connections`, ocean + TanStack Query)

All UI under `platform/apps/web/src/features/connections/`:
`ConnectionsView.tsx` (page organism, two-card single column, `max-w-[660px]`),
`ConnectionCard.tsx` (reusable card shell shared by the WhatsApp + Google cards),
`ConnectGoogleButton.tsx` (prompt-for-secret dialog + initiate),
`DisconnectGoogleButton.tsx` (Radix confirm), `index.ts` barrel.
Hook: `shared/hooks/use-connection-status.ts` (TanStack Query, key `['google','status']`,
`staleTime 30s`, `refetchOnWindowFocus`). API: `shared/api/google.ts`
(`fetchConnectionStatus` [READ_TOKEN], `startGoogleConnect(setupToken)`,
`disconnectGoogle(setupToken)`), parsed by the shared `connectionStatusSchema` so drift fails
loudly (mirrors `events.ts`).

**Ocean tokens (prototype lines 438-441 + globals.css):** card `bg-card` + `var(--shadow-paper)` +
radius 12px + padding 22px; 46×46 icon tile (radius 11px, color-washed bg); 7px `StatusDot` (green
connected, `--muted-foreground` not-connected); channel name 700/16px; status 600/12px; description
`--muted-foreground` 13.5px.

**NOT-CONNECTED (first-load default):** muted-gray icon wash, `לא מחובר`, description
`חבר את חשבון Google של המשפחה כדי לסנכרן יומן ולזהות הודעות Gmail`, primary full-width
`חבר Google` with the official Google G SVG (brand white, NOT `--primary`). Click → Radix dialog
with one `dir=ltr` password Field `קוד הגדרה` (the `SETUP_TOKEN`, **component state only**, cleared
on close/timeout); submit → `startGoogleConnect()` with Bearer → `{ url }` → `window.location.assign`.
Inline Hebrew errors: 401/403 `קוד שגוי`, 429 `יותר מדי ניסיונות, נסו בעוד רגע`, 503 `Google לא מוגדר בשרת`.

**CONNECTED:** green `StatusDot` + `מחובר`; friendly scopes via a hardcoded map
(`Gmail (קריאה בלבד) · יומן Google`, `dir=ltr` tabular-nums); `expiresAt` rendered Asia/Jerusalem;
ghost/destructive `נתק`. Disconnect → Radix confirm requiring `SETUP_TOKEN` (held in a short-lived
ref, cleared on close) → `disconnectGoogle()` → `invalidateQueries(['google','status'])`.

**LOADING:** Skeletons inside the card shell, CTA disabled. **ERROR:**
`לא ניתן לבדוק את מצב החיבור` + retry, never crash. **SHIPS-DARK/503:** non-actionable
`Google לא מוגדר` note, never a Connect button.

**RTL:** single column, logical props (`ps-/pe-/ms-/me-`); `SETUP_TOKEN` input + scopes line are
`dir=ltr`; the Google G SVG is direction-neutral (do NOT rtl-flip). **Return loop:**
`ConnectionsView` reads `?status=` (TanStack typed search param) and maps it through the **shared
`Outcome` enum** (one source of truth, exported from `@homeos/shared`) to a Hebrew banner
(`חשבון Google חובר בהצלחה` / error copy), then strips the param. Keep the prototype WhatsApp card
above the Google card; disable `+ הוסף ערוץ` until a second channel exists.

## 6. Security guards (mechanism per guard)

- **OG20 / RESOLVED-4 (privilege split UPHELD):** writes (`connect-url`, `disconnect`) use
  `SETUP_TOKEN`/`ADMIN_TOKEN`; the non-secret status read uses `READ_TOKEN`. A leaked read token can
  never start a grant or disconnect.
- **OG7 (CSRF) verbatim:** single-use, family-bound, ~10-min `oauth_state` via atomic
  `DELETE...RETURNING`; state never originates in the SPA.
- **OG14 (redirect_uri pinning) verbatim:** `GOOGLE_REDIRECT_URI` is static config, never derived
  from web origin / Host / `X-Forwarded-*`. The web button only STARTS the flow; Google still calls
  back to the server.
- **OG16 (reflected-XSS) verbatim:** callback page stays a static allowlisted-enum string with CSP
  `default-src 'none'`; the web maps `?status=` through the shared enum, never renders a raw param.
- **OG17 (granted-scope re-validation) verbatim** at the callback.
- **NEW account-identity pin:** `userinfo.email === ALLOWED_GOOGLE_EMAIL` before upsert; upsert
  refuses to overwrite a present row → closes the account-mixup hijack (the gate is not the write
  boundary; Google consent is).
- **OG15/OG18 EXTENDED (now actually implemented):** `gateMatches` before `issueState` (unauth probe
  mints no state); per-IP rate limiter (429 + fixed mismatch delay) on the gated routes + callback;
  constant-time compare; boot entropy check on `SETUP_TOKEN`.
- **OG3 (no token leakage):** status returns only `{ connected, scopes?, expiresAt? }`; never tokens
  / refresh / enc key; `SETUP_TOKEN` never logged.
- **OG21-OR (open-redirect):** bounce target = boot-validated `https://` `WEB_BASE_URL` (explicit
  allowlist) + allowlisted slug ONLY; built by hand; `Referrer-Policy: no-referrer`; never forward
  `c.req.query()`. No `?next=`/`?return_to=`.
- **Gate-as-attack-surface:** `SETUP_TOKEN` is server-only, runtime-typed, never a `VITE_*` var,
  never a cookie (bearer-only invariant, documented as a trip-wire).
- **Ships-dark three-gate invariant preserved:** no `GOOGLE_*` → deps undefined → every route
  (incl. the new ones) 503 → zero Google calls; web renders non-actionable "not configured".
- **Phase-8 hard guard:** `upsert`/`issueState` assert `familyId === 'default'` and throw otherwise,
  so a second family is a loud failure, not a silent unverified-cap / CASA breach.

## 7. Compliance

Scopes are unchanged: `gmail.readonly` (restricted) + `calendar` (sensitive). The dogfood runs the
OAuth app in **Production publishing but UNVERIFIED** (non-expiring refresh tokens, 100-user cap,
honest unverified-app warning on the consent screen). At public launch (#29/#30) `gmail.readonly`
forces **CASA Tier 2** + a published privacy policy. `ALLOWED_GOOGLE_EMAIL` + the `FAMILY_ID==='default'`
hard guard keep the deployment single-account. **Compliance trip-wire:** a polished one-click button
lowers friction to onboard a second family, silently crossing the 100-user cap + CASA obligations;
sharing the connect link outside the household flips the verification clock. The hard guard turns
that into a code-level error rather than a quiet breach.

## 8. File plan

**Server:**
- `apps/server/src/config.ts` — `SETUP_TOKEN?`, `WEB_BASE_URL?`, `ALLOWED_GOOGLE_EMAIL?` folded into
  `readGoogleBundle` (optional within the all-or-nothing required five); boot entropy/distinctness
  check on `SETUP_TOKEN`; `WEB_BASE_URL` validated as absolute `https://` (allowlist).
- `apps/server/src/http/oauth-routes.ts` — `gateMatches`; new `/oauth/google/connect-url`,
  `/oauth/google/status`, `/oauth/google/disconnect`; callback email-pin + overwrite-guard + bounce
  branch; remove legacy `/connect/google` + `/disconnect/google`; thread `setupToken`/`readToken`/
  `webReturnUrl`/`allowedEmail` into `GoogleOAuthDeps` via `buildGoogleDeps`.
- `apps/server/src/google/oauth.ts` — add a lean `fetchUserInfoEmail(accessToken)` (node:fetch to
  the userinfo endpoint) used only at the callback.
- `apps/server/src/http/rate-limit.ts` — minimal per-IP fixed-window limiter (new).
- `apps/server/README.md` — env + threat model + Phase-8 trip-wire.

**Shared:**
- `packages/shared/src/index.ts` — `connectionStatusSchema` + inferred type; export the `Outcome`
  enum (one source of truth for the `?status=` slug, parsed both sides).

**Web:**
- `apps/web/src/shared/api/google.ts` + barrel export.
- `apps/web/src/shared/hooks/use-connection-status.ts` + barrel.
- `apps/web/src/features/connections/{ConnectionsView,ConnectionCard,ConnectGoogleButton,DisconnectGoogleButton,index}.tsx`.
- `apps/web/src/test/msw/handlers.ts` — connected/not-connected/503 handlers.

## 9. Build order (small shippable steps)

1. **Shared:** `connectionStatusSchema` + exported `Outcome` enum.
2. **Server config:** `SETUP_TOKEN` / `WEB_BASE_URL` / `ALLOWED_GOOGLE_EMAIL` + boot checks; thread
   into `GoogleOAuthDeps`. (No route behavior yet.)
3. **Server:** rate limiter + `gateMatches`.
4. **Server:** `GET /oauth/google/status` (READ_TOKEN), `GET /oauth/google/connect-url`,
   `POST /oauth/google/disconnect` (shared body); remove legacy routes.
5. **Server:** callback email-pin + overwrite-guard + WEB_BASE_URL bounce + `Referrer-Policy`.
6. **Web:** `shared/api/google.ts` + `use-connection-status` + msw handlers.
7. **Web:** `features/connections` UI (card / connect dialog / disconnect / return banner).
8. **Docs:** README env + threat model + Phase-8 trip-wire.

## 10. Risks & open questions (every critique folded)

**Security blockers — addressed:**
- *Gate is bypassable; account-mixup hijack* → **ALLOWED_GOOGLE_EMAIL pin + overwrite-guard** at the
  callback (§3.3 #5, §6). The token gate is correctly NOT treated as the write boundary.
- *Rate limit was vapor; status on the kiosk polling path leaks the privileged token* → **implement a
  real per-IP limiter**; **status gated by READ_TOKEN** (non-secret payload), keeping `SETUP_TOKEN`
  off the tablet (§3.1, §6).
- *WEB_BASE_URL open-redirect / Referer leak; the "redirect_uri under WEB_BASE_URL" check is
  backwards* → **drop that check** (they are legitimately different origins), validate `WEB_BASE_URL`
  as an absolute `https://` allowlist, build the bounce by hand, set `Referrer-Policy: no-referrer`,
  never forward the callback query (§6 OG21-OR).

**Security concerns — addressed:**
- *DevTools visibility / re-typing on disconnect* → token held in a short-lived in-memory ref cleared
  on close/timeout; documented as a known family-device limitation.
- *Status `get()` decrypts on every poll* → accepted as-is for one family (over-eng lens agrees a
  single AES-GCM decrypt is free); `has()` deliberately NOT added.
- *CSRF on POST disconnect beyond bearer* → bearer-only-never-cookie invariant documented as a
  trip-wire; optional CORS allowlist on the new routes.
- *Phase-8 trip-wire not enforced* → `upsert`/`issueState` hard-assert `familyId==='default'`.

**Over-engineering concerns — addressed:**
- *Six endpoints where three suffice* → collapsed to ONE gate function accepting EITHER token; legacy
  routes removed; single `/oauth/google/*` prefix.
- *`has()` premature* → dropped; use `credentials.get`.
- *Dual-mode callback boot assertion false-positives cross-origin* → kept the cheap dual-mode branch,
  dropped the backwards assertion, replaced with a plain `https://` format/allowlist check.
- *Threat-model over-specified* → shipped the load-bearing minimum (timingSafeEqual + high entropy +
  gate-before-issueState + a small limiter); no login-throttling subsystem.
- *Two status enums* → the `Outcome` enum is exported once from `@homeos/shared` and parsed both sides.
- *Route naming inconsistency* → all new routes use `/oauth/google/*`.

**Open questions:**
- **Where is the web build served?** If Cloudflare Pages (cross-origin from the Railway API), the new
  routes need a CORS allowlist; the bearer-no-cookie gate already sidesteps SameSite. (Needed before
  step 4.)
- **Confirm the OAuth app stays Production-publishing-but-UNVERIFIED** (non-expiring tokens); else a
  7-day testing-mode refresh expiry forces weekly re-connect.
- **No connected-account email shown in the card** — `ALLOWED_GOOGLE_EMAIL` is known at config time
  and could be displayed; deferred (scopes + expiry already confirm "connected").
