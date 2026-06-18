# Google OAuth — setup runbook (per-family, opt-in)

> Operator checklist to stand up the Google OAuth credential flow for HomeOS (#16).
> Companion to the design doc `docs/design/google-oauth-plan.md`. **The browser/visual flow only
> works once #60 (the routes + config bundle) ships** — but the Google Cloud steps (Tracks 1–4)
> are external and can be done **now, in parallel** with the build. Tracks 5–6 are the activation.

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

## Track 5 — Wire the env bundle (all-or-nothing) — *activates once #60 ships*

Set **all** of these (local `.env` for dev; Railway **Variables → Raw Editor** for prod). The bundle is
validated as a group: a half-configured set fails fast at boot; an empty set ships dark.

| Var | Value | Source |
|-----|-------|--------|
| `GOOGLE_CLIENT_ID` | OAuth client id | Track 3 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | Track 3 |
| `GOOGLE_REDIRECT_URI` | the **exact** callback URL for this environment | Track 3 |
| `GOOGLE_TOKEN_ENC_KEY` | base64 32-byte AES key | Track 4 |
| `ADMIN_TOKEN` | random bearer (≠ `READ_TOKEN`) | Track 4 |
| `PUBLIC_BASE_URL` | *(optional)* public origin, boot sanity-check only | — |

> Use the **right `GOOGLE_REDIRECT_URI` per environment** (localhost for local, the Railway URL for prod)
> and make sure each is registered in Track 3. A mismatch → Google `redirect_uri_mismatch`.

## Track 6 — The visual / manual test (the first clickable surface) — *needs #60*

Once #60 has shipped and the bundle is set:

```bash
# terminal: run the server
pnpm dev    # in platform/

# browser (or curl): start the grant — note the ADMIN_TOKEN bearer
#   GET http://localhost:3000/connect/google   with header  Authorization: Bearer <ADMIN_TOKEN>
```

Expected:
1. `GET /connect/google` (with `ADMIN_TOKEN`) → **302 redirect to Google's consent screen** (you'll
   see the "unverified app" warning → *Advanced → continue*).
2. Approve → Google redirects to `GET /oauth/google/callback?code&state` → HomeOS exchanges the code
   and renders a **Hebrew RTL "connected ✅" page**.
3. **Verify it stored encrypted:** a row appears in the `credentials` table whose `enc_*` columns are
   ciphertext (never the plaintext token).
4. **Disconnect (reversible):** `POST /disconnect/google` (with `ADMIN_TOKEN`) → revokes at Google +
   deletes the credential → back to app-only.

Sad paths to eyeball: a cancelled consent → Hebrew "cancelled" page (no token stored); a bad/expired
`state` → `403`; the bundle unset → `503` (dark).

---

## Guardrails this setup honors

- **OG14** redirect URI is pinned config, exact-match — never built from request headers.
- **OG20** `/connect`+`/disconnect` gated by `ADMIN_TOKEN`, distinct from the read-only kiosk `READ_TOKEN`.
- **OG1/OG2** tokens AES-256-GCM at rest; a wrong/changed `GOOGLE_TOKEN_ENC_KEY` **fails loud at boot**
  (the #58 key-canary) rather than silently degrading — if you rotate the key, you must re-consent.
- **OG16** the Hebrew result page is static/allowlisted (no reflected XSS).
- **App-only stays provable:** unset bundle ⇒ zero Google calls (config + data + type gates).

## Where this maps in the build

| Built by | Piece |
|----------|-------|
| #58 ✅ merged | encrypted credential store + crypto + key-canary |
| #59 (next) | state/CSRF store + lean fetch client + `getValidAccessToken` |
| **#60** | **the 3 routes + `GOOGLE_*` config wiring + Hebrew result page ← Tracks 5–6 light up here** |
| #61 | reversibility/deletion seam (provider-tagged rows + backup-retention guard) |
| #17 / #18 | the actual Gmail read + Calendar sync tools (consume `getValidAccessToken`) |
