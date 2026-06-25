# Google OAuth — setup runbook (per-family, opt-in)

> Operator checklist to stand up the Google OAuth credential flow for HomeOS (#16).
> Companion to the design doc `docs/design/google-oauth-plan.md`. The full flow is **shipped** — #60
> (the routes + config bundle) **and #10 (the self-serve web Connect flow)** are merged. The Google
> Cloud steps (Tracks 1–4) are external and one-time; Tracks 5–6 are the activation (env + the test).

## What this sets up

A single grant that lets **one family** connect Gmail (read) + Google Calendar to HomeOS. It is an
**opt-in privacy expansion**: with the `GOOGLE_*` env bundle unset, the feature **ships dark** — the
routes return `503`, no Google client is constructed, and HomeOS makes **zero** Google API calls
(the forward-only / allowlist red line is unchanged). Setting the full bundle turns it on.

**Scopes requested (minimum):** `gmail.readonly` + `calendar`. Hardcoded server-side; never widened.

---

## Track 1 — Google Cloud project (~2 min)

1. Go to <https://console.cloud.google.com> → **Create project** (e.g. `homeos`).
2. **APIs & Services → Library** → enable **Gmail API** and **Google Calendar API**.

## Track 2 — OAuth consent screen (~5 min) ⚠️ publishing-status choice matters

1. **APIs & Services → OAuth consent screen**. User type: **External**.
2. App name (e.g. `HomeOS`), your support email, developer email. (Logo/links optional.)
3. **Scopes** → add `.../auth/gmail.readonly` and `.../auth/calendar`.
4. **Publishing status — choose deliberately:**
   - **✅ Recommended for dogfooding: "Publish to production" but DO NOT submit for verification.**
     Result: refresh tokens **don't expire**, you'll see a one-time **"Google hasn't verified this
     app"** warning (click *Advanced → continue*), and there's a **100-user lifetime cap** (a single
     family is fine).
   - ❌ Alternative "Testing" mode: refresh tokens **expire after 7 days** → forces weekly re-consent.
     HomeOS degrades gracefully (a revoked/expired token → app-only + a quiet Hebrew reconnect), but
     it's friction you don't want for daily use.

> **Restricted-scope note:** `gmail.readonly` is a *restricted* scope. A third-party **CASA** security
> assessment is only required to **go public / multi-family** (tracked in #29/#30 / Phase 8) — **not**
> for single-family unverified dogfooding. Calendar scopes are *sensitive* only (no CASA).

## Track 3 — OAuth client + redirect URIs (~3 min) ⚠️ exact-match

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add the ones you'll use (must match `GOOGLE_REDIRECT_URI` **exactly**,
   character-for-character; this is pinned config, never derived from request headers — OG14):
   - Local: `http://localhost:3000/oauth/google/callback`  *(port 3000 is the dev default)*
   - Prod:  `https://homeos-production-83a4.up.railway.app/oauth/google/callback`
4. **Create** → copy the **Client ID** and **Client secret**.

## Track 4 — Generate the app secrets (~1 min)

```bash
# AES-256-GCM key that encrypts tokens at rest (#58 consumes this; wrong/changed key fails LOUD at boot)
openssl rand -base64 32     # → GOOGLE_TOKEN_ENC_KEY  (must be a 32-byte base64 value)

# Bearer that gates /connect + /disconnect — a PRIVILEGED write surface, DISTINCT from READ_TOKEN (OG20)
openssl rand -hex 32        # → ADMIN_TOKEN
```

## Track 5 — Wire the env bundle

Set these in the local `.env` for dev, or Railway **Variables → Raw Editor** for prod.

**Core bundle (all-or-nothing)** — validated as a group: a half-configured set fails fast at boot; an
empty set ships dark (503, zero Google calls).

| Var | Value | Source |
|-----|-------|--------|
| `GOOGLE_CLIENT_ID` | OAuth client id | Track 3 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | Track 3 |
| `GOOGLE_REDIRECT_URI` | the **exact** callback URL for this environment | Track 3 |
| `GOOGLE_TOKEN_ENC_KEY` | base64 32-byte AES key | Track 4 |
| `ADMIN_TOKEN` | random bearer (≠ `READ_TOKEN`) | Track 4 |

> Use the **right `GOOGLE_REDIRECT_URI` per environment** (localhost for local, the Railway URL for prod)
> and make sure each is registered in Track 3. A mismatch → Google `redirect_uri_mismatch`.

**Self-serve web flow (#10) — three OPTIONAL extras within the bundle above.** Each absent ⇒ admin-only
mode (connect via the `ADMIN_TOKEN` curl path), unchanged. Set all three to let a family connect from the
web **Connections** screen.

| Var | Value | Constraints |
|-----|-------|-------------|
| `SETUP_TOKEN` | `openssl rand -base64 32` | The bearer the web connect/disconnect flow needs. Boot-validated: **≥ 32 bytes** of base64 entropy AND **distinct** from `READ_TOKEN` *and* `ADMIN_TOKEN`. **Never a `VITE_*` var** — it's typed into the web dialog at runtime, never bundled. |
| `WEB_BASE_URL` | `https://homeos-production-83a4.up.railway.app` | Absolute **`https://`** URL on the in-code `ALLOWED_WEB_ORIGINS` allowlist (boot-validated). The callback bounces the browser to `${WEB_BASE_URL}/connections?status=<outcome>`. Unset ⇒ the callback renders a static Hebrew page instead. |
| `ALLOWED_GOOGLE_EMAIL` | the family's Google address | The consenting account's email must match (case-insensitive), else `bad_account`. Unset ⇒ unenforced. |

## Track 6 — Connect & test

The bundle set, there are two ways in. **The legacy `GET /connect/google` + `POST /disconnect/google`
routes were removed in #10** — the routes are now all under `/oauth/google/*`.

### A) The real path — the web Connections screen (needs the self-serve trio set)

1. Open the app → **Connections** (`/connections`). The Google card shows **"לא מחובר"** with a **"חבר
   Google"** button.
2. Click it → a dialog prompts for the **setup code** → type the `SETUP_TOKEN` → it navigates to Google's
   consent screen (the "unverified app" warning → *Advanced → continue*).
3. Approve → Google redirects to `/oauth/google/callback` → HomeOS validates state, **pins the account
   email** against `ALLOWED_GOOGLE_EMAIL`, stores the encrypted credential, and **bounces** back to
   `…/connections?status=connected` (a one-time Hebrew success banner; the param is then stripped).
4. The card flips to **"מחובר"** with the granted scopes + the access-token expiry. **"נתק"** disconnects
   (re-prompts for the setup code → revoke at Google + delete locally).

### B) The dev / curl path (works with `ADMIN_TOKEN` even without the self-serve trio)

```bash
pnpm dev    # in platform/

# 1) mint the consent URL  (Bearer = SETUP_TOKEN or ADMIN_TOKEN)
#    GET /oauth/google/connect-url   →  { "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }
# 2) open that url in a browser, approve → /oauth/google/callback runs.
#    With WEB_BASE_URL set → 302 bounce to /connections?status=…; unset → a static Hebrew result page.
# 3) status   (Bearer = READ_TOKEN):   GET /oauth/google/status → { connected, scopes, expiresAt }
# 4) disconnect (Bearer = SETUP_TOKEN or ADMIN_TOKEN):  POST /oauth/google/disconnect → { disconnected: true }
```

**Verify it stored encrypted:** a row appears in the `credentials` table whose `enc_*` columns are
ciphertext (never the plaintext token).

Sad paths to eyeball: a cancelled consent → `status=cancelled` (no token stored); a wrong/expired `state`
→ `bad_state`; the wrong Google account, or a re-connect over a present credential → `bad_account` (stores
nothing — disconnect first); a wrong setup code → `401`; too many attempts → `429`; the bundle unset →
`503` (dark).

---

## Guardrails this setup honors

- **OG14** redirect URI is pinned config, exact-match — never built from request headers.
- **OG20** the write routes (`/oauth/google/connect-url` + `/disconnect`) gated by `SETUP_TOKEN` **or**
  `ADMIN_TOKEN` — both distinct from the board `READ_TOKEN`, which only gates the non-secret `/status`
  read. `SETUP_TOKEN` is prompted-for in the web dialog, never bundled; a per-IP rate limiter + the
  `FAMILY_ID==='default'` Phase-8 trip-wire back the write paths (#10).
- **OG1/OG2** tokens AES-256-GCM at rest; a wrong/changed `GOOGLE_TOKEN_ENC_KEY` **fails loud at boot**
  (the #58 key-canary) rather than silently degrading — if you rotate the key, you must re-consent.
- **OG16** the Hebrew result page is static/allowlisted (no reflected XSS).
- **App-only stays provable:** unset bundle ⇒ zero Google calls (config + data + type gates).

## Where this maps in the build

| Built by | Piece |
|----------|-------|
| #58 ✅ | encrypted credential store + crypto + key-canary |
| #59 ✅ | state/CSRF store + lean fetch client + `getValidAccessToken` |
| #60 ✅ | the admin OAuth routes + `GOOGLE_*` config wiring + Hebrew result page |
| #61 ✅ | reversibility/deletion seam (provider-tagged rows + backup-retention guard) |
| #17 / #18 ✅ | the actual Gmail read + Calendar sync tools (consume `getValidAccessToken`) |
| **#10 ✅** | **self-serve web Connect flow — `/oauth/google/{status,connect-url,disconnect}` + the Connections UI + `SETUP_TOKEN`/`WEB_BASE_URL`/`ALLOWED_GOOGLE_EMAIL` + the account-email pin + the `FAMILY_ID==='default'` Phase-8 trip-wire** |
