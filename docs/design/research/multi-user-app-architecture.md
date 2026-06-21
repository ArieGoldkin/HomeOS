# Multi-User App over ONE Shared WhatsApp Bot Number — Architecture

**Date:** 2026-06-21
**Context:** Synthesis for `docs/design/multi-tenant-plan.md` — closes gap #1 (the binding
ceremony) and grounds the §2.2 identity model with concrete provider/mechanism decisions.
Pairs with `docs/design/research/R2-coexistence-findings.md` (which decided shared-number IS the
product). Reuses the plan's split-isolation decision (§2.1), D-item numbering (§4.2), and the
forward-only/allowlist red line.

> **This SUPERSEDES the "own-number" reading of "multi-tenant."** There is **ONE HomeOS-owned
> WhatsApp bot number** (official Cloud API, not a number-per-family). A **family is the tenant**;
> it has **multiple members**. Each member chats **1:1** with the single bot from their personal
> WhatsApp; inbound routes to a family by the sender's `from_phone`. Members also **log into a web
> UI with Google** to view the family board. A member's phone is bound to their account+family via
> an **OTP phone-binding ceremony**. R2 already retired own-number/Coexistence as the near-term
> path; this doc designs the multi-**USER** app that shared-number routing makes possible.

---

## Recommended Architecture

A member arrives at the web app, signs in with their **Google account** (end-user OIDC, distinct
from the admin's Google **data-source** OAuth in #16). The session anchors on the OIDC `sub`. The
member creates or joins a **family** (membership row, not a `family_id` on the user — #23 wants
multiple members per family). They then prove they own the phone that will text the bot via the
**binding ceremony**: enter phone → server stores a **pending claim** with a high-entropy single-use
code → the member **sends that code to the shared bot from their personal WhatsApp** → the inbound
`from_phone` + code matches the pending claim → `family_phones(family_id, from_phone, verified_at)`
is written. From then on, inbound from that phone resolves to that family; the board, scoped by
`family_id`, is read in the browser under the member's JWT.

**Chosen end-user auth provider: Better-Auth** (MIT, self-hosted, first-class Hono integration,
identity in your own DB, zero per-MAU cost). **WHY:** it grafts onto the existing Hono server, keeps
identity data wherever you host (true EU residency by hosting choice, no CLOUD-Act exposure on the
identity tables), runs natively on the current `node:sqlite` and later on Postgres, gives a stable
`session.user.id` to map member→family, and lets the OTP ceremony issue/augment **your own** session
with phone/family claims without a vendor in the loop. *Runner-up:* Supabase Auth (see §End-user
Auth) — only if you firmly commit to Supabase Postgres and want `auth.uid()` to drop straight into
RLS. (Note: the plan's §2.2 names Supabase Auth; this research updates that to Better-Auth for the
identity layer, while keeping Supabase Postgres+RLS as the §2.1 read-path store. Reconcile at D4/D5.)

**Chosen OTP mechanism: user-sends-code-to-bot (Direction B).** The web app **displays** a short
single-use code; the member sends it to the bot from their personal WhatsApp. **WHY:** it is **free**
(user-initiated inbound opens the 24h service window — no template, no opt-in, no approval), and it
is the **most secure** option for this routing model because the code arrives *from* the member's
WhatsApp number, proving they control the exact `from_phone` we route on. It also sits cleanly inside
the forward-only/allowlist red line: the code is just another inbound the resolver inspects, and the
bot's "bound ✓" reply is a free service message. *(Bot-sends-template OTP is the priced fallback —
§OTP.)*

```
 BROWSER PATH                                      BOT PATH (shared number)
 ───────────                                       ────────────────────────
 member → web app
   │  Sign in with Google (Better-Auth OIDC)
   │     └─ session.user.id  ← anchor on OIDC `sub`
   ▼
 create/join family
   └─ family_members(user_id, family_id, role)
   ▼
 BINDING CEREMONY  ── enter phone ──► pending_bindings(family_id, phone, code_hash, expires)
   │                                                       ▲
   │   web shows: "send CODE to the bot"                   │ match (from_phone + code)
   │                                                       │
   └────────────── member sends CODE from personal WA ─────┘
                                              │  inbound webhook  (HMAC-verified)
                                              ▼
                                   family_phones(family_id, from_phone, verified_at)  ← TRUST ESTABLISHED
                                              │
 ┌────────────────────────────────────────────┴───────────────────────────────────┐
 │  RUNTIME: family member forwards a Hebrew message → shared bot                    │
 │     webhook (ack-then-process, HMAC mandatory)                                    │
 │        └─ RESOLVER: from_phone → family_phones → family_id   [PRIMARY GUARD]      │
 │        └─ allowlist/forward gate still applies                                    │
 │        └─ inbound_messages(family_id,…) → parse → events(family_id,…)             │
 ▼                                                                                   ▼
 board read in browser (user JWT)  ◄── family_id scopes everything ──►  events(family_id)
   RLS: family_id IN (SELECT family_id FROM family_members WHERE user_id = auth.uid())
```

The two resolvers (`from_phone → family_phones → family_id` on the bot path;
`session.user.id → family_members → family_id` on the browser path) must **agree on the same
`family_id`**. The binding ceremony is what makes `family_phones` trustworthy.

---

## Data Model

Keyed to code recon. Three tables today lack a tenant column; `credentials` + `oauth_state` are
already `family_id`-keyed (`schema.ts:90-102,143-150`) and are the template to copy.

**Net-new identity tables** (no user/identity/session concept exists anywhere today):

| Table | Columns | Notes |
|---|---|---|
| `users` | `id` (PK), `oidc_sub` (UNIQUE), `email`, `email_verified`, `created_at` | anchor on `oidc_sub` (stable), email is display-only. Better-Auth owns these (or `auth.users` if Supabase Auth). |
| `families` | `id` (PK), `created_at` | the tenant. |
| `family_members` | `user_id` (FK), `family_id` (FK), `role` (`owner`/`member`), `joined_at`, UNIQUE`(user_id, family_id)` | membership join — the browser-path resolver source. |
| `family_phones` | `family_id` (FK), `from_phone`, `verified_at`, `verified_by_user_id`, UNIQUE`(from_phone)` (one active binding per phone) | the bot-path resolver source; only written after OTP success. |
| `pending_bindings` | `family_id`, `phone`, `code_hash`, `attempts`, `expires_at`, `created_at`, UNIQUE`(phone)` | short-TTL claim; code stored **hashed**; consumed once. |

**Tenant columns to add** to the three unscoped tables (mirror the idempotent `ALTER TABLE`
pattern already proven at `schema.ts:35` for `source_provider`):

- **`events`** (`schema.ts:9-28`) — **the one table where `family_id` is genuinely absent.** Add the
  column + a per-`family_id` index. **Migration is lossy:** backfill historical rows from
  `from_phone → allowlist` (low risk at dogfood scale; confirm clean-cutover vs. backfill at D3).
  Make `EventStore`'s 3 reserved `_familyId` no-ops real (`WHERE family_id = ?` in
  `deleteById`/`findEventsByRef`/`updateEvent`, `event-store.ts:180-197`) and add `family_id` to the
  5 unscoped methods (`saveEvent`/`listEvents`/`deleteLastFromSender`/`countSince`/`deleteByProvider`).
  `deleteLastFromSender` + `findEventsByRef` are destructive/cross-row — they leak/delete across
  tenants if left unscoped.
- **`inbound_messages`** (`schema.ts:43-53`) — has `from_phone`, no `family_id`. Add the column;
  scope `countFromSenderSince` (the G16 ceiling, currently global) and `statsSince` (digest). PK stays
  `wa_message_id` **under shared-number routing** (Meta IDs are globally unique). Add `listRecent()` +
  a nullable `outcome` column for the messages-display feature (D2, ships pre-multi-tenancy — build
  tenant-ready).
- **`conversations`** (`schema.ts:167-187`) — **the catastrophic migration.** The index is a plain
  `UNIQUE(from_phone)` (`schema.ts:184-187`) and `create()` uses `INSERT OR REPLACE` on it. Under
  shared-number routing, two families' members with the same phone string collide → **silent
  cross-tenant pending-thread takeover.** Change to **`UNIQUE(family_id, from_phone)`** and add
  `familyId` to `create`/`getPending`/`resolve`/`expireStale`. **Must land before the 2nd family.**

`credentials` + `oauth_state` need **no schema migration** — only the id source changes from the
`FAMILY_ID` constant to the resolved id. (The `credential_key_canary` single global enc-key is a
separate blast-radius gap — plan §2.4; `enc_key_version` already reserves rotation.)

---

## The Binding Seam & Security Boundary

The `from_phone → family` resolver is the **single chokepoint**. It plugs in at
`core/handler/inbound.ts:54` — replacing the global `isAllowed(msg.from, deps.allowlist)` gate with a
per-family lookup against the verified `family_phones` table — because it runs **before** any model
call, persistence, or reply, so the resolved `family_id` threads into every downstream store call
(replacing the `FAMILY_ID` constant at `inbound.ts:145,155,166,176,211,248` and in
`cancel`/`clarify`/`correction`/`edit.ts` + `oauth-routes.ts:106,123,142,157,165`). It must be
**one well-tested, security-reviewed seam, never duplicated per milestone.**

**Why it is the security boundary, not a convenience:** the bot writes as the trusted backend. On
Postgres it connects with `service_role`, **which ALWAYS bypasses RLS** [first-party: Supabase]. On
`node:sqlite` there is no RLS at all. So **app-layer `WHERE family_id = $1` is the PRIMARY guard with
no backstop** (plan §2.1). A wrong mapping here leaks/corrupts across tenants silently. Enforce it
structurally: a `FamilyScopedStore` type that cannot be called without a `family_id` derived from the
verified session/binding — never from request input.

**The OTP proves ownership.** An unverified phone claim must **never** resolve to a family. The code
arrives *from* the member's WhatsApp number (Direction B), so a successful match proves device
control of that exact `from_phone`.

**Attacker cases and how the design blocks them:**

1. **Bind-before-verify / self-asserted phone.** Blocked: `family_phones` is written **only** after a
   matching code arrives over WhatsApp from the claimed number. Entering a phone in the web form
   alone never creates a binding (only a `pending_bindings` row).
2. **Forged-webhook spoofing (the central, must-fix gap — critic's biggest risk).** The webhook is a
   public URL; per Meta's own guidance anyone who finds it can POST a forged `from`/body **unless
   `X-Hub-Signature-256` (APP_SECRET HMAC) is verified** [first-party: Meta webhooks overview].
   Today the HMAC is **optional** (`http/server.ts:110-115`: `if (deps.appSecret !== undefined)`).
   Without it, an attacker who knows a victim's phone string and guesses the code can forge
   `from=victim, body=code` and bind the victim's phone to the **attacker's** family — defeating the
   ceremony end-to-end. **Mandatory HMAC verification is a hard prerequisite before the 2nd family.**
3. **Online code-guessing.** Mitigated by: high-entropy single-use codes (≥6 chars from a large
   alphabet, not a 6-digit numeric), short TTL (~5 min), `attempts` counter with lockout, and
   per-`from_phone` rate-limiting (the inbound path is free + unauthenticated until matched).
4. **Phone reuse / transfer (Israeli MNP / SIM-swap).** `family_phones` enforces one active binding
   per phone; re-bind forces a **fresh OTP** and invalidates the prior binding + sessions. Consume
   Meta's first-party **identity-change signal** (`user_id` update / `identity_key_hash` in the
   messages webhook) to detect number recycling and trigger re-verification [first-party: Meta
   messages webhook reference].
5. **Cross-family hijack (capturing a seat in family A).** A phone already bound to family A must
   **refuse** silent re-point to family B. Releasing a bound phone requires an explicit, authorized
   transfer flow (owner-initiated unbind, or fresh OTP that invalidates A's binding) — **not** a new
   Google account silently re-running OTP. (This authorization flow is an open design item — §Open
   Questions.)
6. **Cross-tenant query leak.** Every store method takes `family_id`; destructive cross-row methods
   are family-scoped; a test asserts a member of family A cannot read/write family B rows even through
   the privileged store.

**App-layer `family_id` guard is primary; RLS is browser-read defense-in-depth only.**

---

## End-user Auth

**Decision: Better-Auth.** MIT/self-hosted → identity data stays in your own DB (true EU residency by
hosting choice, no CLOUD-Act exposure on identity tables); **zero per-MAU cost** (fits ≤$100/mo
trivially); first-class **Hono** integration matching the existing server; native **SQLite** (start
on `node:sqlite`) **and** Postgres (survives the Supabase migration); Google social sign-in built in;
stable `session.user.id` to map member→family; lets the OTP ceremony issue/augment **your own**
session/JWT with phone+family claims. [first-party: Better-Auth — MIT license, Hono integration,
installation/DB support, Google provider]

**Runner-up: Supabase Auth.** Choose **only if** you firmly commit to Supabase Postgres: `auth.uid()`
drops straight into RLS with the least glue, EU region (Frankfurt `eu-central-1`) is selectable, and
Google login is built in. [first-party: Supabase auth-google, RLS, pricing, regions] **Trade-off:**
couples identity to a US-parent SaaS (Schrems II / CLOUD-Act caveat [third-party: danubedata]) and is
harder to fully self-host. **Pragmatic combo:** Better-Auth as the auth/session layer **on** Supabase
Postgres — you own the identity tables, RLS keys on your own `user_id` column. **Avoid Clerk** (no EU
data residency, no self-hosting [third-party: dev.to review]). Raw Google OIDC is the
zero-dependency fallback if you accept building sessions/CSRF/storage yourself.

> Cost note: this updates plan §2.2 (which assumed Supabase Auth + the Pro-plan "free-tier pauses
> after 7 days" fatal-for-a-bot constraint). Better-Auth removes the auth-vendor coupling; the
> always-on bot still needs an always-on **host** (the bot process), but that is true regardless of
> the auth choice. Supabase Pro ($25/mo) is still needed *if* you adopt Supabase Postgres at D5.

---

## OTP Phone-Binding

**Mechanism: user-sends-code-to-bot (Direction B) — primary.** After Google login the member enters
their phone; the app generates a short single-use code (~5-min TTL) and instructs the member to send
it to the bot from their personal WhatsApp. Inbound match binds `from_phone → account → family`.

- **Free.** User-initiated inbound opens the 24h service window; the inbound message is never charged
  and the bot's "bound ✓" Hebrew reply is a free service message — no template, no opt-in, no
  approval. [first-party: Meta send-messages / pricing — non-template messages free inside the CSW]
- **Most secure** for this routing model: the code provably originates from the claimed WhatsApp
  number, validating the exact `from_phone` we route on.
- **Inside the red line:** the code is an allowlisted inbound; the reply is a free service message.

**Fallback: bot-sends authentication-template OTP (Direction A).** Use only if you later want the app
to push the code *to* WhatsApp. **+972 cost: ~$0.0053 per authentication message**, with
**Authentication-International = n/a (no international surcharge)** — confirmed on **Meta's
first-party rate card** (effective April 1, 2026) [first-party: Meta WhatsApp pricing; the earlier
WEB-FINDINGS figure cited only a third-party aggregator — this elevates it to first-party]. Adds
template approval + an opt-in/number-confirmation obligation + per-message cost, with **no security
advantage** over Direction B.

**Avoid SMS-OTP for Israel** except as a last-resort fallback for WhatsApp/number mismatch: Twilio
outbound SMS to +972 is **~$0.2575/segment** (~48× the WhatsApp auth rate) [first-party: Twilio IL
pricing] — erodes the budget fast.

The binding flow is a **deterministic code exchange** — it sends **no primary AI/LLM content** — so
it is unaffected by the §AI-ToS risk.

---

## Shared-number Operational Limits

For the confirmed reply-within-window model (member forwards → bot replies), the **messaging-limit
tiers largely do not bite**: limits only count unique users messaged **outside** an open 24h window;
free-form replies inside it are unlimited "service messages" needing no template/tier headroom.
[first-party: Meta messaging-limits, send-messages]

- **Quality strike-radius (the real shared resource).** The per-number quality rating (green/yellow/
  red) is computed from blocks/reports/mutes/archives across **all** families on that number over a
  rolling 7 days; high-traffic numbers can swing "within minutes." **One family reporting the bot as
  spam degrades the rating for everyone** — and one shared number = one ToS strike radius (R2 / plan
  §6 R2). [first-party: Meta send-messages quality rating; business.help quality states]
- **24h service window.** Opens/resets on each inbound; outside it you can send only pre-approved
  templates. Keep the bot strictly reply-within-window. [first-party: Meta send-messages]
- **Opt-in is required even for replies** — capture an explicit per-member opt-in **at the binding
  ceremony** (log consent text + timestamp; the OTP-bound phone is the consent record of truth), and
  make **unbind/STOP trivial** so frustrated members opt out instead of pressing "report spam."
  [first-party: Meta send-messages opt-in reminder; Business Messaging Policy]
- **When one number stops scaling.** Future **proactive** notifications (window closed) need approved
  templates + per-user opt-in + portfolio messaging-limit headroom (new portfolios start at 250
  unique/24h). The hard ceiling is **80 messages/sec** per number (inbound+outbound combined) + a
  same-user pair-rate limit. At dogfood scale this is generous; model "one number per N families" so
  you can shard (portfolio cap: 2 numbers new, 20 once verified) before quality-contagion or
  throughput approaches. [first-party: Meta throughput, messaging-limits, phone-numbers]

This reconciles with forward-only: the allowlist/forward gate still runs inside the resolver; only
allowlisted inbound is processed, dropped-before-storage/Claude otherwise.

---

## AI-ToS Risk

**The question:** the 2026 WhatsApp **Business Solution Terms** "AI Providers" clause (last modified
March 6, 2026) prohibits AI/ML/LLM providers from using the Business Solution "when such technologies
are the **primary (rather than incidental or ancillary) functionality**," with an exception **only**
for "WhatsApp users who have registered phone numbers with a **European Economic Area or Brazil**
country code." **+972 (Israel) is excluded from that exception** [first-party: Meta Business Solution
Terms — both verbatim quotes confirmed].

**Reading for HomeOS:** the EEA/Brazil carve-out governs only entities whose offering **is** the AI
(primary functionality). HomeOS offers a "forward a Hebrew message → structured family-board event"
service; the LLM is an **incidental/ancillary** parsing engine producing a structured record, never
an open-domain conversational reply. That maps onto the **permitted ancillary category** — which is
allowed in **any** geography — so the +972 exclusion most plausibly **does not bite**. [first-party
text affirms ancillary AI is permitted; third-party interpretations (respond.io, Turn.io, TechCrunch)
consistently classify structured/task-specific bots as compliant.]

**Confidence: MEDIUM.** Two caveats keep it below certain: (1) the primary-vs-ancillary determination
is reserved **"to Meta in its sole discretion"** — Meta could unilaterally reclassify; (2) **no
first-party Meta source adjudicates HomeOS's exact use case**, and no first-party example list of
"incidental vs primary" exists — the allowed-use examples are third-party only. This is a **residual,
platform-existential risk that the architecture cannot engineer around** — if Meta classifies HomeOS
as primary-AI, the **entire shared-+972 product is blocked**. It touches the **WHOLE product**, not
one feature.

**Posture (lock in):** keep the single-purpose / no-open-domain guardrail as a **hard ToS
requirement** (not just design choice); replies are structured Hebrew confirmations only; maintain
the forward-only allowlist; add a human-escalation path (Messaging Policy automation requirement);
honor the **training-data clause** — confirm with Anthropic (zero-retention / no-training config) that
forwarded Business Solution Data does not train any model beyond your own exclusive fine-tune
(**open compliance item — unverified against Anthropic's first-party terms**); do **not** market
HomeOS as an "AI assistant"; retain the verbatim ToS quotes for a defensible rationale; log an
explicit **accepted-risk register entry** for the sole-discretion exposure.

---

## Phased Build Plan

Grafts onto existing seams and reuses the plan's D-numbering (§4.2). **D1, D2 ship on current
single-tenancy now**; the spine (D3→D4→D5) is the multi-user core.

| Phase | What | depends_on |
|---|---|---|
| **D1 — Durability SPOF** | Real offsite uploader (one Litestream replica prefix per family file). Engine-independent; makes file-per-family safe at >1 family. | — (ships single-tenant now) |
| **D2 — Messages display** | `InboundStore.listRecent()` + nullable `outcome` column + token-gated `GET /messages` + shared contract + `MessagesView`. Build the `family_id` seam **tenant-ready** (defaults to `"default"`) so D3 is additive. | — (ships single-tenant now; R1 ✅) |
| **D3 — Tenant columns + store scoping** | Add `family_id` to `events`/`inbound_messages`/`conversations`; `UNIQUE(family_id, from_phone)`; make EventStore's 3 reserved params real + scope the 5 unscoped methods; `FamilyScopedStore` type; tests prove cross-tenant queries return empty. Still SQLite. | R3 |
| **D4 — Identity + binding ceremony** | Better-Auth (Google OIDC) on Hono; `users`/`families`/`family_members`/`family_phones`/`pending_bindings`; the **Direction-B OTP ceremony**; **the resolver** replacing `FAMILY_ID` at all ~16 call sites (bot path + browser path agree). **Make webhook HMAC mandatory.** Security-reviewed + test-gated (no RLS backstop). | R3, D3 |
| **D5 — Supabase migration (driver swap)** | Swap `createXxxStore(dbPath)` factories to Postgres behind the same interfaces; RLS for **browser reads** (`family_id IN (SELECT … WHERE user_id = auth.uid())`); bot on **session-mode pooler**, literal `WHERE family_id = $1` (never a GUC); app-encrypted credential blobs preserved; Frankfurt `eu-central-1`. Resolve the `(family_id, wa_message_id)` PK question (shared-number → PK stays). | R3, D3, D4 |
| **D6 — Per-user connections** | Session-gate `/oauth/google/*` (replace `ADMIN_TOKEN`); resolved `family_id`; pin connected email to **this** user; remove the `family_id==='default'` trip-wire; live `ConnectionsView`. **GATES #29 + #30** (removing the trip-wire crosses the privacy/CASA clock). | R4, R5, D4 |
| **D7 — Billing** | Stripe Checkout + signed idempotent webhook → `subscriptions(family_id)`; grace-period policy that keeps ingesting but degrades, reconciled with #29 retention. | R5 (#29), D4 |
| **D8 — Realtime board** | Postgres Changes / Broadcast-from-DB with RLS; replaces the 30s poll. | D5 |
| **D9 — Own-number onboarding (Coexistence)** | **DEFERRED per R2** — only if +972 Coexistence is first-party-confirmed AND the group-chat dependency is cleared. Stays gated; shared-number is the product. | R2 (hard), R5, D4 |

**Anti-abuse hardening (fold into D4, do not defer):** mandatory HMAC; high-entropy single-use codes;
per-`from_phone` rate-limit + lockout on the free inbound path; the already-bound-phone transfer-authz
flow; consume Meta's identity-change signal for re-verification.

---

## Citations

**First-party — Meta / WhatsApp**

- `https://www.whatsapp.com/legal/business-solution-terms/` — [first-party] — verbatim "AI Providers"
  primary-vs-ancillary prohibition + EEA/Brazil-only exception (excludes +972); training-data clause.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/` —
  [first-party] — webhook URL is public; forged POSTs possible unless `X-Hub-Signature-256` verified
  (makes HMAC mandatory).
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages`
  — [first-party] — `from`/wa_id is a Meta-authenticated sender id; identity-change signal for
  number-recycling re-verification.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing` — [first-party]
  — +972 Authentication = $0.0053, Authentication-International n/a; non-template messages free inside
  the open customer-service window.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages`
  — [first-party] — 24h service window; free service messages; quality rating signals; opt-in even
  for replies.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits` —
  [first-party] — limits count unique users **outside** the window; portfolio-level 250→Unlimited.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/` —
  [first-party] — 80 mps per number (inbound+outbound); same-user pair-rate limit.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers`
  — [first-party] — portfolio number cap (2 new → 20 verified) bounds family sharding.

**First-party — auth / DB / OTP fallback**

- `https://better-auth.com/docs/integrations/hono` + `/docs/installation` + `/docs/authentication/google`
  — [first-party] — Hono integration, SQLite/Postgres support, Google social sign-in (chosen provider).
- `https://github.com/better-auth/better-auth` — [first-party] — MIT license / self-host.
- `https://supabase.com/docs/guides/database/postgres/row-level-security` — [first-party] —
  service_role **bypasses RLS** (app-layer guard is primary); `auth.uid()` policy pattern.
- `https://supabase.com/docs/guides/auth/social-login/auth-google`, `/pricing`,
  `/docs/guides/platform/regions` — [first-party] — Google OIDC, free/Pro pricing, Frankfurt region
  (runner-up provider).
- `https://www.twilio.com/en-us/sms/pricing/il` — [first-party] — +972 SMS ~$0.2575/segment (SMS-OTP
  fallback is costly).
- `https://openid.net/developers/how-connect-works/` — [first-party] — OIDC `sub` is the stable
  account anchor.

**Third-party (corroborating, flagged)**

- `https://respond.io/blog/whatsapp-general-purpose-chatbots-ban`,
  `https://learn.turn.io/l/en/article/khmn56xu3a-whats-app-s-2026-ai-policy-explained` — [third-party]
  — structured/ancillary bots permitted (interpretation, not Meta text).
- `https://dev.to/.../clerk-vs-better-auth-2026-...`, `https://danubedata.ro/blog/supabase-alternatives-europe-gdpr-2026`
  — [third-party] — Clerk no EU residency; Supabase US-parent CLOUD-Act caveat.
- `https://www.vaadata.com/blog/what-is-pre-account-takeover-...`,
  `https://www.prove.com/blog/recycled-phone-numbers` — [third-party] — pre-account-takeover /
  recycled-number pitfalls the ceremony blocks.

---

## Confidence & Open Questions

**Overall confidence: MEDIUM.** The architecture is well-grounded in code recon (resolver seam at
`inbound.ts:54`, the three unscoped tables, the `conversations` collision) and mostly first-party
sources for the mechanics. It is **not** ready to greenlight a 2nd family until the binding-seam
security pass lands.

**Load-bearing claims WITHOUT first-party backing (these LOWER confidence — stated explicitly):**

1. **AI-ToS permissibility on +972 (MEDIUM).** Rests on Meta's "sole discretion" with **no
   first-party adjudication** and no first-party "ancillary vs primary" example. Platform-existential;
   the architecture cannot engineer around it. (R2 / V2 both land here.)
2. **Anthropic training-data compliance — UNVERIFIED.** Whether Anthropic's default API
   retention/zero-retention satisfies the BST training clause is not confirmed against Anthropic's
   first-party terms. Concrete remediation exists (enable no-training/ZDR) but is unconfirmed.
3. **Better-Auth `session.user.id` stability + which OIDC claims (`sub`/`email`/`email_verified`) are
   persisted** were not fully confirmed on the public docs — verify against the API reference before
   wiring the family mapping.
4. **node:sqlite-vs-Supabase decision still OPEN** (plan-locked to "SQLite now → Supabase once," but
   the trigger is unresolved). Under SQLite there is **no RLS at all**, so the app-layer
   `FamilyScopedStore` guard is the **sole** boundary — raising the stakes on the resolver being
   provably correct + test-gated.
5. **Already-bound-phone transfer/release authorization flow — UNDESIGNED.** Who authorizes releasing
   a phone bound to family A so it can move to family B is undefined (the cross-family-hijack half of
   the binding-seam threat). Must be specified before D4 ships.
6. **EU adequacy for Israel** (plan §2.6) — asserted from blogs; confirm against an EU Commission
   primary source; plan a contingency if it lapses.

**Hard prerequisites before the 2nd family (not optional):** mandatory webhook HMAC; high-entropy
single-use binding codes with per-phone rate-limit + lockout; the transfer-authz flow; consume Meta's
identity-change signal; the `UNIQUE(family_id, from_phone)` conversations migration.
