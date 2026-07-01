# WhatsApp × Meta Wiring Plan (HomeOS)

Goal: make WhatsApp onboarding **fully self-serve and production-ready** — a family member can bind their WhatsApp sender from the web app without a dev editing an ENV, and the bot can be messaged by arbitrary (non-allowlisted) users on a real, verified number. Current state: the **web login flow is done** (email invite → Google login → auto-claim, plus owner revoke of a bound sender, #262); `family_phones` is still **ALLOWLIST-seeded at boot** (#229 D2); the **#228 wa.me binding ceremony's SERVER CORE is already built + merged** (PR #236 — `phone_binding` table, `binding-store`, the inbound branch) and **only its web half remains** (a session-gated issue endpoint + the wa.me card — see §5); and go-live gates **#30/#31** (single-purpose re-verify, business verification + permanent token + real number) remain. App is LIVE in prod on Railway today on what is most likely the Meta **test number**.

> **Chosen path (2026-07-01):** FULL GO-LIVE is the destination. The go-live prerequisites (a registered business entity, a domain, a dedicated number) are **not yet in hand** — this doc is the ongoing checklist to work through them. Meanwhile the remaining **#228 web half is being built now** so the code is ready + dormant by the time the Meta-side setup clears.

## 0. TL;DR — the shortest path

**A) Self-serve phone binding (end to end):**
1. **[code]** Build the **#228 web half** — the server core (table + `issueBinding`/`matchBinding` + inbound branch) is **already merged**; remaining = wire `bindings` into `ServerDeps` + a session-gated issue endpoint + swap `QRConnectBlock.tsx` for the wa.me card (section 5). *(In progress.)*
2. **[env]** Set `BOT_PHONE_NUMBER` on Railway (display number the wa.me card links to) — currently OPTIONAL/likely unset.
3. **[Meta console]** Add + verify a **REAL phone number** on the WABA so arbitrary users can message it (section 3), OR keep the test number and register each tester as an allowed recipient for dev only.
4. **[Meta console]** Get **Advanced Access** on `whatsapp_business_messaging` (App Review) + App Live, so non-allowlist users can be messaged back (section 2d) — this is what makes the wa.me ceremony *useful* beyond 5 test recipients.

**B) Go-live (arbitrary users, stable auth):**
5. **[Meta console]** Complete **Business Verification** (Security Center) — #31.
6. **[Meta console]** Mint a **permanent System User token**, swap into `WHATSAPP_TOKEN` on Railway — #31.
7. **[Meta console]** Register the real number (2-step PIN), display name approved.
8. **[review]** Re-verify **single-purpose / forward-only** posture against the 2026 AI policy — #30.

Steps 1–2 and 6 are the only ones touching **code/env**; everything else is **Meta-console** work.

## 1. Current state (what's already wired)

| Item | Value / where | Status |
|---|---|---|
| `PHONE_NUMBER_ID` | Opaque Meta id in the Graph send URL (`/{id}/messages`), from **App Dashboard → WhatsApp → API Setup**. NOT dialable. | ✅ set (prod likely on the **test** number's id) |
| `WHATSAPP_TOKEN` | Graph API `Authorization: Bearer`. **Temp token expires ~24h**; permanent = System User token. | ⚠️ set — **likely still a short-lived/temp token**; permanent token is #31 |
| `VERIFY_TOKEN` | Your chosen string for the webhook GET handshake (`hub.verify_token`). | ✅ set, wired in `http/webhook.ts` |
| `APP_SECRET` / HMAC | `X-Hub-Signature-256` HMAC over raw POST body. Schema says OPTIONAL but **prod boot REFUSES to start without it**; 403 on missing/forged. | ✅ set + **mandatory** at runtime |
| `BOT_PHONE_NUMBER` | OPTIONAL display-only human number (e.g. `+972 50-123 4567`), #231. Served by `GET /channel`. | ❌ likely **unset** — needed for the #228 wa.me card |
| Webhook `messages` subscription | **App Dashboard → WhatsApp → Configuration → Webhook fields → Manage → `messages`**. | ✅ subscribed |
| `family_phones` seeding | `from_phone → family_id` binding the admission gate (#259) reads; **seeded from ALLOWLIST env at boot** (#229 D2). | ⚠️ works, but **no self-serve binding** — that's #228 |
| Outbound send | Single POST `graph.facebook.com/{GRAPH_VERSION}/{PHONE_NUMBER_ID}/messages`, free-form text. **Only delivers inside the 24h window** the user's inbound opens. No templates anywhere. | ✅ correct for a reply-only bot |
| `GRAPH_VERSION` | Default `v21.0`. | ✅ set |

## 2. Meta developers console checklist

### (a) App dashboard — webhook + app secret
- [ ] **App Dashboard → WhatsApp → Configuration → Webhook → Edit** — set **Callback URL** to the prod HTTPS `…/webhook` and **Verify token** = your `VERIFY_TOKEN`. (Already verified — re-confirm on any host change.)
- [ ] Same page → **Webhook fields → Manage** — confirm **`messages`** is subscribed. ✅ done
- [ ] **App Dashboard → App Settings → Basic → App Secret → Show** — this is `APP_SECRET`. Keep **"Require app secret" / payload verification** enabled (server already enforces the HMAC). ✅ done

### (b) Phone number & display name
- [ ] **Test number reality check:** the Meta-provided test sender (App Dashboard → WhatsApp → API Setup) **receives inbound from anyone**, but can only **send to ≤5 verified recipients** and its **token expires in ~24h**. Not production.
- [ ] **Add a REAL number:** **App Dashboard → WhatsApp → API Setup → Add phone number** (or **WhatsApp Manager → Account tools → Phone numbers → Add phone number**) → display name, timezone, business category.
- [ ] **Verify** via SMS/voice 6-digit code → number status must become **Connected** in WhatsApp Manager.
- [ ] **Two-step PIN:** set the 6-digit PIN (required to register/keep the number; needed again on any re-register; no API to disable it once set).
- [ ] **Display-name approval:** submitting a name triggers **Meta review** (minutes → ~2 days). Must relate to the real business, ≥3 chars, match external branding; **no** personal names, generic terms, emojis, URLs, or "Official"/"Verified"/Meta product names. Status shows Pending/Approved/Rejected.
- [ ] Note: **existing personal number** works only if it's **not active on any WhatsApp/WhatsApp Business app** first (delete it there); migration to Cloud API is effectively **one-way**.

### (c) Permanent token (System User)
- [ ] **business.facebook.com → Business Settings → Users → System Users → Add** → name `homeos-wa`, role **Admin**.
- [ ] **Assign Assets** → the **App** (Full control) + the **WABA** (Full control) (+ phone-number asset if surfaced).
- [ ] **Generate New Token** → select the App → **Expiration: Never** → tick **`whatsapp_business_messaging`** *and* **`whatsapp_business_management`** → Generate → copy once.
- [ ] This value becomes `WHATSAPP_TOKEN` on Railway (see section 3 for the swap + staged-var risk).

### (d) Business verification + advanced access (message arbitrary users)
- [ ] **Business Verification:** **Business Manager → Security Center → Business Verification** — legal name, address, phone, matching-domain website/email, official docs. ~2–10 business days. Required to exceed the **250 unique-customer conversations / rolling 24h** unverified cap.
- [ ] **App Review → Advanced Access** on `whatsapp_business_messaging` (+ `_management`) — required so the bot can **send to non-allowlisted users** (dev standard access = only 5 test recipients).
- [ ] **App set to Live** (App Dashboard toggle).
- [ ] Net rule to message arbitrary users on a direct app: **(a) Advanced Access via App Review + (b) Business Verification + (c) App Live + registered real number w/ 2-step PIN.**

## 3. Test-number → real-number cutover

Concrete sequence:
1. **[Meta]** Add + verify the real number on the WABA, set 2-step PIN, get display name approved (section 2b). New number → new **`PHONE_NUMBER_ID`**.
2. **[Meta]** Register the real number (it must show **Connected**).
3. **[Railway env] change three vars together:**
   - `PHONE_NUMBER_ID` → the real number's id (the test-number id stops routing).
   - `WHATSAPP_TOKEN` → the **permanent System User token** (section 2c) — do this in the same cutover so you're not on a 24h clock.
   - `BOT_PHONE_NUMBER` → the real dialable display number (drives the wa.me card).
4. **[Meta]** Ensure Advanced Access + App Live + Business Verification are in place, or arbitrary users still can't be replied to.

**Risk notes:**
- 🔒 **Staged-var injection (memory: railway-staged-var-injection):** a Railway var can read as "set" in the CLI yet **not inject at runtime** on a staged change → boot canary crash-loops (and prod refuses to boot without `APP_SECRET`). **Re-save + redeploy + runtime-probe** all three vars before declaring the cutover done.
- **Re-register** the number if it ever gets re-added; the 2-step PIN is needed again.
- The **wa.me link only works for real users once a real messageable number exists** and (for non-allowlist senders) **Advanced Access is granted** — until then the ceremony is limited to the ≤5 test recipients.
- Deploy via the **`production` branch** (`git push origin main:production`), verify `railway status --json` active commit + `status==SUCCESS` (commit flips while still BUILDING).

## 4. Go-live gates

- [ ] **#30 — single-purpose policy re-verify (pre-launch):** confirm the bot stays **forward-only + single-purpose**: no open-domain / "ask me anything", the LLM is never positioned as the product, every reply is tied to the one utility (forward Hebrew → structured family event/confirm). This is the load-bearing gate for the **15 Jan 2026 AI-provider ban** (general-purpose chatbots barred; single-purpose utility bots explicitly still allowed). Maps 1:1 to HomeOS's existing red lines — keep them enforced.
- [ ] **#31 — permanent token:** System User token, **Never** expiry, both WhatsApp scopes (section 2c).
- [ ] **#31 — business verification:** approved in Security Center (unlocks >250/24h + Live).
- [ ] **#31 — real number:** added, verified, Connected, 2-step PIN, display name approved.
- [ ] **Advanced Access + App Live** so non-allowlist users can be replied to (section 2d).
- [ ] Opt-in / 24h-window discipline: outside an open window only **approved templates** send (error `131047` otherwise) — HomeOS is reply-only inside the window, so this stays satisfied as long as we never try to cold-message.

## 5. Code work for #228 (the wa.me binding ceremony)

The ceremony makes the **web-session code the OTP** and the **WhatsApp echo the proof**, riding the **free 24h window** the inbound opens — **no Authentication/OTP template**, so it avoids the verification/volume/policy brush of templates.

### ✅ Server core — ALREADY BUILT + MERGED (PR #236)
- ✅ **`phone_binding` table** (`CREATE_PHONE_BINDING_TABLE`, `db/schema.ts`) — `code TEXT PK`, `family_id`, `expires_at`.
- ✅ **`db/binding-store.ts`** — `issueBinding(familyId)` mints a `HOME-XXXXX` code from an unambiguous alphabet (no `0/O`, `1/I/L`), ~10-min TTL, PK-collision retry; `matchBinding(code, fromPhone)` **peeks the code's family before consuming** (so a cross-family echo doesn't burn the legit single-use code), returns `bound` / `wrong_family` / `null`, and on a valid same/new-family code does `DELETE … RETURNING` + `INSERT OR IGNORE INTO family_phones` (normalized phone).
- ✅ **Inbound pre-allowlist branch** (`core/handler/inbound/components/binding.ts` → `tryBindPhone`) — runs BEFORE the #259 admission gate (binding *creates* the allowlist entry), cheap on the miss path (one regex `BINDING_CODE_RE`), tolerant of surrounding prose. Three Hebrew replies: `BIND_OK_HE` (bound), `BIND_WRONG_FAMILY_HE` (already another family), `BIND_INVALID_HE` (wrong/expired). Wired in `index.ts` (`bindings` in the handler deps).
- ✅ **Security posture** built correct from day one: unguessable code + TTL + single-use consumption + peek-before-consume + no cross-family bind. (This is the seam with no RLS backstop.)

### ⬛ REMAINING — the web half (the only #228 work left)
- [ ] **Wire `bindings` into the HTTP `ServerDeps`** — currently `bindings` (the `BindingStore` from `index.ts:138`) is passed only to the INBOUND handler deps, NOT to `createServer`. Add `bindings?: BindingStore` to `ServerDeps` and pass it in `index.ts`'s `serverDeps`.
- [ ] **Session-gated issue endpoint** — e.g. `POST /binding` (guarded like the other read routes): calls `deps.bindings.issueBinding(familyId)` for the session's `familyId`, returns `{ code }`. 503 when `bindings` unwired (mirrors the invite-route posture). Owner OR member may bind their own phone (not necessarily owner-only — decide during build).
- [ ] **Web card** — replace the static pseudo-QR in **`apps/web/src/features/onboarding/components/QRConnectBlock.tsx`** with a card that requests a code and renders:
  - a **`wa.me/<digits>?text=<encoded>`** tap link, text = `קוד חיבור HomeOS: HOME-XXXXX`, via `encodeURIComponent`;
  - the code as **copyable plaintext** fallback + "send this exact message to the bot".
  - `<digits>` must be **digits-only** (strip `+`/spaces/dashes/leading zero — e.g. `+972 50-123 4567` → `972501234567`); the number comes from **`GET /channel`'s `botPhone`** (already served from `BOT_PHONE_NUMBER`). Degrade gracefully when `botPhone` is null (show the code + instruction, no tappable link).
- [ ] **Interlock / dependency:** the ceremony is only **useful once the bot number can be messaged by arbitrary (non-allowlist) users** — i.e. it needs the **real number + Advanced Access** from sections 2–3. On the **test number**, only the ≤5 registered recipients can complete it (fine for dev). Set `BOT_PHONE_NUMBER` before shipping the card, or the wa.me link has no target. **Building the web half now = it sits ready (dormant) until the real-number cutover**, exactly like the other pre-wired-but-dormant slices.

## 6. Open questions / decisions

- **Direct Cloud API vs a BSP?** Direct (current) = we own App Review + Business Verification + webhook + token, full control, no per-message markup. A BSP (360dialog/Twilio/etc.) already holds Advanced Access → skip our App Review + Embedded Signup, faster go-live, but markup + less control. The **single-purpose AI ban applies identically** either way. Lean: stay direct (matches the ≤$100/mo, foundation-first posture) unless App Review stalls.
- **When to trigger Business Verification?** It's ~2–10 days and gates both >250/24h and Advanced Access — start it **before** building demand, in parallel with #228 code, not after.
- **Keep the ALLOWLIST seed as a fallback alongside #228?** Recommended yes, short-term: the boot-time seed guarantees the dev/family are always admitted even if a binding is fumbled. Revisit retiring it once #228 is proven in prod and self-serve is the primary path.
- **Which number becomes the real sender?** New dedicated number vs migrating an existing one (one-way, can't stay on the consumer app) — decide before section 3, since it fixes `BOT_PHONE_NUMBER` and the wa.me target.
- **Test-recipient allowlist during dev:** register each tester's number in App Dashboard → API Setup so the free-form confirm reply delivers while still on the test number.

---

*Sources (research pass, Jul 2026): Meta for Developers — WhatsApp Cloud API Get Started / Business phone numbers / Two-Step Verification / Webhooks reference / Messaging Limits / Using Authorization Tokens; WhatsApp Help Center — click to chat; Meta Business Help — Display Name + Quality rating; TechCrunch / respond.io / Mobile Ecosystem Forum — WhatsApp 2026 AI-provider policy. Meta's own doc pages are JS-rendered (fetched truncated); console-step details corroborated against the official Business Help Center + current integration guides. The outside-window error code `131047` is from the Cloud API error reference (not re-verified live).*
