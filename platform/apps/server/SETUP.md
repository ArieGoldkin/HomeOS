# HomeOS — first-run setup (Demo 2)

Everything you need to take `@homeos/server` from code to a live WhatsApp bot that turns a
forwarded Hebrew message into a calendar event. Work top-to-bottom in **one sitting** — the
WhatsApp test token expires after 24h.

- **`.env` location:** `platform/apps/server/.env` (the server reads it from its own directory).
  Create it with `cp env.example .env` and fill the blanks as you go.
- **Tailored to:** a Facebook account (no Business portfolio yet) + an Anthropic Console account
  with billing. The permanent-token block at the end is for later ("before dogfood").

---

## Track 1 — Anthropic API key (~2 min)

- [ ] Go to **console.anthropic.com → API keys → Create key** (name it `homeos-dev`).
- [ ] Copy it (shown once) → `.env` as `ANTHROPIC_API_KEY=...`.

> Billing is already on, so you're done. The default model is `claude-sonnet-4-6` (best Hebrew date accuracy per the golden eval); still cents-to-low-dollars/month at family volume. Swap via `ANTHROPIC_MODEL` (e.g. `claude-haiku-4-5` for cheaper testing).

---

## Track 2 — WhatsApp Business Cloud API

### A. Create the Meta app
- [ ] **developers.facebook.com** → log in with Facebook → register as a developer (verify email/phone if asked).
- [ ] **My Apps → Create App** → use case **Other** → type **Business** → name `HomeOS` → **Create**.
- [ ] App dashboard → **Add product → WhatsApp → Set up**. If prompted for a Business portfolio, let it
      **create one**. This provisions a **test WhatsApp Business Account + a test phone number**.

### B. Grab credentials (WhatsApp → API Setup)
- [ ] Copy the **Temporary access token** (24h) → `.env` `WHATSAPP_TOKEN`.
- [ ] Copy the test number's **Phone number ID** (under the `From` field) → `.env` `PHONE_NUMBER_ID`.
      ⚠️ This is the *ID*, not the phone number.
- [ ] Under **To**, **add recipient numbers** (your phone + family testers, max 5, E.164 like `9725…`).
      Each gets a WhatsApp code to verify. **These same numbers go in `.env` `ALLOWLIST`** (comma-separated).
- [ ] *(Optional)* Click **Send message** on that page — proves the send path before any code runs.

### C. Run the server + expose it (two terminals, both stay open)
- [ ] Terminal 1 — from `platform/`: `pnpm install && pnpm dev`  (server on `:3000`)
- [ ] Terminal 2: `cloudflared tunnel --url http://localhost:3000`
      (`brew install cloudflared` first if needed). Copy the `https://<random>.trycloudflare.com` URL.
      ⚠️ This URL **changes every restart** — keep the tunnel running; if it changes, redo step D.

### D. Connect Meta to your webhook (WhatsApp → Configuration)
- [ ] Pick any long random string for `VERIFY_TOKEN`, put it in `.env`, and **restart `pnpm dev`**.
- [ ] **Callback URL** = `https://<tunnel>.trycloudflare.com/webhook`
- [ ] **Verify token** = your `VERIFY_TOKEN` → click **Verify and save**.
      (Meta calls `GET /webhook`; a green check = success.)
- [ ] Under **Webhook fields**, **Subscribe** to **`messages`**.

### E. Subscribe your WABA to the app ⚠️ easy to miss — required for inbound!
Configuring the webhook above is **not enough on its own**: the WhatsApp Business Account must also be
**subscribed to your app**, or Meta delivers your inbound messages nowhere (the webhook verifies green but
no messages ever arrive). The UI doesn't always do this. Run it explicitly (from `apps/server`, with
`WABA_ID` in your `.env` — it's on the API Setup page):

```bash
set -a; source .env; set +a
GV=${GRAPH_VERSION:-v21.0}
# Subscribe this app to the WABA:
curl -s -X POST "https://graph.facebook.com/$GV/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $WHATSAPP_TOKEN"; echo      # expect {"success":true}
# Verify YOUR app (not just Meta's "WA DevX" app) is now listed:
curl -s "https://graph.facebook.com/$GV/$WABA_ID/subscribed_apps" \
  -H "Authorization: Bearer $WHATSAPP_TOKEN"; echo
```

---

## Wire `.env` + run Demo 2

Your `platform/apps/server/.env` should now have all five required values:

```
VERIFY_TOKEN=...            # the random string you set in step D
WHATSAPP_TOKEN=...          # 24h temp token (step B)
PHONE_NUMBER_ID=...         # step B
ALLOWLIST=9725...,9725...   # = your Meta recipients (step B)
ANTHROPIC_API_KEY=...       # Track 1
```

- [ ] Restart `pnpm dev` after editing `.env`.
- [ ] **🎯 Demo 2:** from an allowlisted phone, forward a Hebrew message to the test number, e.g.
      `תזכורת: אסיפת הורים מחר ב-18:30 בגן רימון`
- [ ] Expect a reply: `הוספתי ליומן ✓` + the parsed title/date.
- [ ] Verify it persisted: `sqlite3 data/homeos.db "select id, kind, title_he, date_iso, time from events;"`

---

## Before dogfood — permanent token (no 24h breakage)

Needs a Meta Business portfolio (created in step A).

- [ ] **business.facebook.com → Settings → Users → System users → Add** (role: Admin).
- [ ] **Assign the app** (`HomeOS`) to that system user.
- [ ] **Generate token** with `whatsapp_business_messaging` + `whatsapp_business_management` permissions.
- [ ] Swap it into `.env` `WHATSAPP_TOKEN` and restart. It no longer expires.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Webhook verifies green but **NO inbound messages arrive** | The WABA isn't subscribed to your app (only Meta's internal "WA DevX" app is). Run the `subscribed_apps` POST in **step E**. This was our #1 time-sink. |
| Webhook **"Verify and save" fails** | `VERIFY_TOKEN` in Meta ≠ `.env`; or you didn't restart `pnpm dev` after editing `.env`; or the tunnel URL changed. Check the server logs for the `GET /webhook` hit. |
| Bot **doesn't reply** to a forwarded message | Sender isn't in `ALLOWLIST` / not a Meta recipient; or you didn't **subscribe to `messages`**; or the tunnel died. |
| Replies **stop after ~a day** | The 24h temp token expired — set up the permanent token (above). |
| Reply is **"couldn't understand, rephrase?"** | Parse returned nothing valid. Try a clearer message; or A/B a stronger model: `ANTHROPIC_MODEL=claude-sonnet-4-6` in `.env`. |
| Server **won't boot** (config error) | A required var is missing/empty in `.env`, or `ALLOWLIST` is empty. The error names the offending variable. |
| `ANTHROPIC_API_KEY` errors | Key missing in `.env`, or no billing/credits on the Anthropic Console account. |

---

*Reference: `README.md` (module map, routes), `docs/idea/architecture-roadmap-playground.html` (roadmap),
`docs/idea/whatsapp-poc-research.md` (2026 WhatsApp policy).*
