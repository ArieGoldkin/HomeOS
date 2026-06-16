# HomeOS — Deploy & Permanent Webhook Setup

> Goal: a **permanent HTTPS webhook URL** for the WhatsApp bot, configured in Meta, with a
> **non-expiring token** — so you can forward real messages from any chat without the local
> tunnel. Host = **Railway** (see `docs/adr/0001-hosting-railway.md` for why).
>
> ⚠️ **Never paste secrets** (WhatsApp token, Anthropic key, app secret) into a chat or a
> third-party agent. Placeholders below (`<…>`) are filled by you, directly in Railway/Meta.

Known identifiers (not secrets):

| | |
|---|---|
| Meta App ID | `868112963028854` |
| WABA ID | `979183104999887` |
| Phone number ID | `1170244819503798` |
| Graph API version | `v21.0` |

---

## Part A — Deploy the server to Railway (the permanent URL)

The app is a Node/pnpm monorepo; the server is at `platform/apps/server` and needs a
**long-running process + a persistent disk** (it returns 200 then processes async, and stores
one SQLite file per family).

1. **railway.app → New Project → Deploy from GitHub repo →** `ArieGoldkin/HomeOS`.
2. **Service → Settings:**
   - **Root Directory:** `platform`
   - **Install Command:** `pnpm install`
   - **Start Command:** `pnpm --filter @homeos/server start`
   - **Node version:** add env var `NIXPACKS_NODE_VERSION = 24` *(required — the app uses
     `node:sqlite`, flag-free only on Node 24)*.
3. **Add a Volume** mounted at **`/data`** (persists the SQLite DB + WAL across deploys).
4. **Environment variables** (fill secrets directly here):
   - `VERIFY_TOKEN` = `<long random string; the SAME value goes into Meta in Part C>`
   - `WHATSAPP_TOKEN` = `<permanent System User token — see Part B>`
   - `PHONE_NUMBER_ID` = `1170244819503798`
   - `ALLOWLIST` = `<comma-separated family numbers, e.g. 972547039199>`
   - `ANTHROPIC_API_KEY` = `<Anthropic key>`
   - `DB_PATH` = `/data/homeos.db`
   - `ANTHROPIC_MODEL` = `claude-haiku-4-5` *(optional)*
   - `READ_TOKEN` = `<optional — long random string; enables GET /events>`
   - `APP_SECRET` = `<optional now — the Meta app secret; enables webhook HMAC verification>`
   - **Do NOT set `PORT`** — Railway provides it; the server reads it automatically.
5. **Deploy.** Copy the public URL, e.g. `https://homeos-production.up.railway.app`.
   The **webhook URL** is that + `/webhook`.
6. **Smoke check:** open `<RAILWAY_URL>/health` → should return `{"status":"ok"}`.

## Part B — Permanent access token (so it never expires in 24h)

1. **business.facebook.com → Business Settings → Users → System Users.**
2. Create/pick a **System User** with Admin role.
3. **Add Assets** → assign the app (`868112963028854`) and the WABA (`979183104999887`) with
   full control.
4. **Generate New Token** → select the app → **Token Expiration: Never** → permissions:
   `whatsapp_business_messaging` + `whatsapp_business_management` → Generate.
5. Use it as `WHATSAPP_TOKEN` in Railway (Part A.4).

## Part C — Point Meta at the permanent URL (once)

1. App Dashboard → **WhatsApp → Configuration:**
   `https://developers.facebook.com/apps/868112963028854/whatsapp-business/wa-settings/`
2. **Webhook → Edit:**
   - **Callback URL:** `<RAILWAY_URL>/webhook`
   - **Verify token:** the SAME `VERIFY_TOKEN` from Railway
   - **Verify and save** → must go green.
3. **Webhook fields → Manage → Subscribe to `messages`.**
4. **Subscribe the WABA to the app** (so inbound is delivered — the #1 gotcha):
   ```bash
   curl -X POST "https://graph.facebook.com/v21.0/979183104999887/subscribed_apps" \
     -H "Authorization: Bearer <WHATSAPP_TOKEN>"
   # expect {"success":true}; verify with the GET form → should list the app, not []
   ```

## Part D — Allow your phone to receive replies (test number only)

`https://developers.facebook.com/apps/868112963028854/whatsapp-business/wa-dev-console/`
→ under recipients ("To"), add + verify your WhatsApp number. *(On the test number the bot can
only reply to pre-added recipients.)*

## Done — test

In the HomeOsBot chat, send: `אסיפת הורים מחר ב-18:30 בגן רימון`
→ expect `הוספתי ליומן ✓` + the date in Hebrew.

> **At the production-number cutover** (issue #31): set `APP_SECRET` to enforce the webhook HMAC
> (#9), and wire the real R2/B2 uploader for the nightly backup (#10).

---

## Local testing without Meta (no tunnel needed)

To prove the bot works without touching Meta, inject a webhook straight at a locally-running
server (this is how the bot was verified on 2026-06-16):

```bash
cd platform && pnpm dev    # real Claude + WhatsApp client; DB at apps/server/data/homeos.db
# then POST a Meta-shaped payload to localhost:3000/webhook with a Hebrew "text" body
# from an allowlisted number → it parses, saves, and (if token+recipient valid) replies on WhatsApp.
```
See also the integration test (`test/integration/flow.test.ts`) and `pnpm digest:preview`.
