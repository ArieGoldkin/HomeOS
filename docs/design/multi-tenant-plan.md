# Multi-Tenant Plan (Phase 8) — HomeOS

> **Status:** Design. Net-new build surface for GitHub **#32** (multi-tenant + auth + billing),
> gated by **#26** (dogfood month) and blocked-for-launch by **#29** (Israeli privacy), **#30**
> (WhatsApp policy), **#31** (go-live).
>
> **Builds on locked decisions — do NOT re-open:**
> - **DB engine:** stay `node:sqlite` file-per-family **now**; migrate to **Supabase Pro (EU/Frankfurt),
>   single Postgres DB + RLS, ONCE**, at the dashboard/Realtime/multi-tenant milestone
>   (`CONTINUITY_homeOS.md`, 2026-06-20 7-agent re-confirm; Turso "scale leg" downgraded → contingent).
> - **Tenancy line:** one family = one `EventStore` behind the store interfaces; the **driver swaps,
>   the interface does not** (`docs/design/google-oauth-plan.md`, issue **#32** acceptance (d)).
> - **Credential schema is already Phase-8-isolation-ready:** `credentials` + `oauth_state` carry
>   `family_id`, PK `(family_id, provider)`, every query `WHERE family_id = ?`
>   (`platform/apps/server/src/db/credential-store.ts`, `db/schema.ts`).
> - **`FAMILY_ID = "default"` is a deliberate trip-wire**, not a bug (`db/schema.ts:135`).
>
> This plan is **foundation-first and solo-dev realistic**. It treats the user's stated vision
> ("sign up → scan a code → connect your own bot → see your messages") as a **hypothesis with hard
> verification gates**, and designs a shippable shared-number fallback as the real near-term path.

---

## 0. The gap headline

The six investigations are individually strong but were run as **parallel silos**. Synthesis exposes
three load-bearing things they collectively missed, and this plan is organized around closing them:

1. **No end-to-end seam connects signup → phone-ownership-proof → WhatsApp onboarding → `family_id`
   resolution.** The **phone↔account binding ceremony** is the wall nobody drew. The bot resolves a
   tenant from `from_phone`; the browser resolves it from a JWT `auth.uid()`. **These are two
   resolvers for two entry paths that must agree** via a shared `family_members` join — and the
   ceremony that lets a signed-up user prove they own the phone that texts the bot is undesigned.
2. **A live contradiction: "RLS isolates tenants" (assumed by the tenancy-seams / connections /
   docs findings) vs "the bot writes with `service_role`, which BYPASSES RLS" (supabase-auth-billing).**
   On the write path RLS protects nothing; **app-layer `WHERE family_id = $1` is the *primary* guard,
   not defense-in-depth.** This promotes the phone→family **resolver to a security-critical, must-be-
   tested boundary with no RLS backstop.**
3. **The QR "scan-to-connect" keystone (WhatsApp Coexistence) is UNVERIFIED for Israeli (+972)
   numbers AND structurally fights the forward-only/allowlist red line** (CLAUDE.md: "never all
   chats"). Coexistence links a family's *whole live number* to Cloud API — every message it receives
   hits the webhook, not just forwarded ones. The product the user described may not be buildable as
   imagined; the fallback (shared number, route-by-`from_phone`) is a **different product**.

---

## 1. Current state — how single-tenancy is baked in

Single-tenancy is not one switch; it is a set of concrete seams. (Audit: `tenancy-seams` finding.)

### 1.1 `FAMILY_ID = "default"` — a constant, not an identity
A hardcoded string (`db/schema.ts:135`) passed as the family argument in **11 source files**:
- `core/handler/inbound.ts` (`:145,155,166,176,211,248`) — credential reads + tool context.
- `core/handler/{correction,cancel,edit,clarify}.ts` — every store call (delete/find/update/calendar).
- `http/oauth-routes.ts` (`:106,123,142,157,165`) — OAuth state issue/consume, credential upsert/get/delete.
- `tools/tools.ts:76` — `ToolContext.familyId` documented as "today the single-family `FAMILY_ID`".
- Scripts `gmail-e2e.ts`, `calendar-e2e.ts`.

The doc comment is explicit (`schema.ts:131-134`): *"A constant, NOT a resolved identity… Phase 8
swaps it for a real resolver."*

### 1.2 Allowlist is the implicit family resolver
One flat global phone list, `ALLOWLIST` env → `string[]`, validated `.min(1)` (`config.ts:45`,
`core/allowlist.ts:11`). `isAllowed(phone, allowlist)` checks against the *one* list with **no family
scoping**; the gate fires at `inbound.ts:54`. Any allowlisted phone implicitly belongs to the one
family. **This is the seam that must become a phone→family lookup** — the linchpin everything else
hangs off.

### 1.3 File-per-family — one `DB_PATH`, one SQLite file shared by all stores
All four stores open the same file (`index.ts:37-49`): `createEventStore`, `createInboundStore`,
`createConversationStore`, and `createCredentialStore` (via `buildGoogleDeps`). Each `createXxxStore`
factory takes only `(dbPath)` — **no tenant parameter**. Doc strings say "the one family file"
outright (`inbound-store.ts:51-53`, `conversation-store.ts:78-82`). This factory pattern is exactly
the **driver-swap seam** the Supabase migration relies on.

### 1.4 Tables with NO tenant column (`db/schema.ts`)
- `events` (`:9-28`) — keyed `(wa_message_id, seq)`, **no `family_id`**. Today "family scope" literally
  means `source_provider IS NULL` (board rows), not a tenant filter; `EventStore`'s `familyId` params
  on `deleteById`/`findEventsByRef`/`updateEvent` are **reserved no-ops** (`event-store.ts:180-197`,
  `_familyId`). `saveEvent`/`listEvents`/`deleteLastFromSender`/`countSince`/`deleteByProvider` take
  no family arg at all.
- `inbound_messages` (`:43-53`) — PK `wa_message_id`, has `from_phone` but **no `family_id`**; G16
  per-sender ceiling counts across the whole file.
- `conversations` (`:167-187`) — **UNIQUE on `from_phone` alone** (`:184`). **This is the riskiest
  cross-tenant collision:** two families' members with the same phone string collide on the "one
  pending thread per sender" index.
- `credential_key_canary` (`:110-116`) — single-row, **one global `GOOGLE_TOKEN_ENC_KEY`** for every
  family's tokens.

### 1.5 Send-only / receive WhatsApp — no per-user onboarding
The WhatsApp layer is **send-only** (`whatsapp/client.ts`) + receive (`http/webhook.ts`). There is
**no per-user bot onboarding, no QR, no number-connection** (`whatsapp-onboarding` finding; #31 commits
to ONE real number + business verification for the single dogfood). The only onboarding built (#98)
is a 4-step first-run UI + a how-it-works *demo* — visual, not real number provisioning.

### 1.6 Inbound messages: saved, never displayed
`inbound_messages` already durably stores `wa_message_id + from_phone + type + text + status +
received_at + processed_at` **before the 200 ack** (`http/server.ts:127-128`). So **"save the
messages" is largely DONE** at the data layer. But it is a dedup/replay queue: consumers are
boot-replay, the daily digest (`statsSince`), and the G16 ceiling (`countFromSenderSince`). There is
**no `listRecent()`, no read endpoint, no web consumer** — `WhatsAppIngestion.tsx` is a static mock.
(`messages-and-ui` finding.)

### 1.7 Single global config + admin model
One `loadConfig()` parse (`config.ts:177`) → one allowlist, one `members` map, one `dbPath`, one
Google bundle, one `adminPhone` (defaults to `allowlist[0]`, `index.ts:141`), one set of cost
ceilings. Auth today is **shared bearer tokens** — `READ_TOKEN` (in the Vite bundle, "not real
auth"), `WRITE_TOKEN`, `ADMIN_TOKEN`. They answer "is the caller an operator?", never "which user?".

---

## 2. Target architecture — the multi-user system

### 2.1 The two isolation models (the corrected framing — Risk 2)

> **DECISION (locked by the service_role finding):** HomeOS does **not** fit the textbook
> browser-JWT RLS pattern. The data writer is the **WhatsApp bot server**, a trusted backend that
> connects with the **`service_role` key, which BYPASSES RLS entirely**
> ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)).

**Split-brain isolation — adopt explicitly:**

| Path | Who | Guard | Why |
|---|---|---|---|
| **Bot write path** | server (`service_role`) | **App-layer `WHERE family_id = $1`** in the store drivers — **PRIMARY guard** | RLS is bypassed; the only thing standing between two families' data is the resolver + the query predicate |
| **Browser read path** | user JWT (board, messages, Realtime) | **RLS** (`family_id IN (SELECT family_id FROM family_members WHERE user_id = (SELECT auth.uid()))`) | defense for "a user only reaches their own family's board" — #32 acceptance (b) |

**Consequences this plan enforces:**
- The **phone→family resolver is a security-critical boundary**, test-gated and security-reviewed,
  not a convenience. A bug that maps the wrong `family_id` from a `from_phone` **leaks/corrupts across
  tenants with no RLS backstop**.
- The `conversations` UNIQUE-on-`from_phone` collision (§1.4) becomes **catastrophic** under
  service_role writes → it MUST become `UNIQUE (family_id, from_phone)` before any 2nd family.
- **Bot uses the session-mode pooler** (long-lived connection) or a small direct pool — **never the
  transaction-mode pooler with a GUC.** **Never `SET app.tenant_id`; only `SET LOCAL` inside a txn if
  ever forced.** Prefer literal-bound `WHERE family_id = $1` everywhere (the pooler footgun is the
  documented privacy red line — `CONTINUITY`, supabase-auth-billing).
- **Credential blobs stay app-encrypted** regardless of RLS, since service_role bypasses it; the key
  lives in env/secret manager, never in Postgres.

### 2.2 Identity / signup / auth (net-new — the core of #32)

Today there is **no user/identity model, no sessions/cookies, no PKCE** — deliberately cut for the
single family (`web-google-connect-plan.md §3.2`). Build:

- **Supabase Auth** (email/password + Google OAuth login). Pro plan **mandatory**: free-tier projects
  **pause after 7 days idle** — fatal for an always-listening bot (supabase-auth-billing; itpathsolutions).
- **`families` table** (net-new) + **`family_members(user_id, family_id, role)` membership table** —
  membership, not a bare `family_id` on the user, because **#23** wants multiple users per family.
- **`family_id` in `app_metadata`** (server-only, user cannot edit) via a **Custom Access Token Hook**,
  so it lands in the JWT for RLS reads. **Never** put tenant identity in `user_metadata` (user-editable).
- **The resolver** (replaces the `FAMILY_ID="default"` constant at ~11 call sites): a phone→family
  lookup keyed off verified `from_phone`(s) on the bot path, and `auth.uid()`→membership on the
  browser path. **Both must resolve to the same `family_id`.**

### 2.3 Per-user WhatsApp bot onboarding — the verdict

> **RESEARCH VERDICT (`whatsapp-onboarding`):** A generic "scan to connect" does NOT exist. The only
> flow matching "user scans a code to connect THEIR number" is **WhatsApp Coexistence inside Embedded
> Signup** — link an **existing WhatsApp *Business App* number** to Cloud API by scanning a QR; both
> app + API stay live. (A `wa.me` QR only opens a chat — wrong tool. Plain Embedded Signup registers a
> NEW dedicated number via OTP, no QR.)

**Two hard problems with the QR keystone (Risk 1 / Risk 3):**
1. **Israel (+972) availability is UNVERIFIED.** Sources conflict: two BSP docs (GoHighLevel,
   WANotifier) list only Nigeria/South Africa as unsupported; one snippet claimed EEA/EU/UK excluded.
   **This is a BLOCKING gate** — confirm on Meta's first-party Coexistence availability page before
   any onboarding build.
2. **Coexistence inverts the allowlist red line.** Linking a family's whole live number means **every
   message it receives flows to the webhook**, not just forwarded/allowlisted ones — contradicting
   CLAUDE.md's "process only forwarded/allowlisted messages, never all chats." Plus the target market
   uses **personal** WhatsApp; Coexistence requires a **Business App** number → a conversion-killing
   migration prerequisite.

**DECISION — two-phase onboarding (do not let UX outrun Meta):**

- **Phase A (now → first few families): shared single number YOU own, route by `from_phone`.** No
  Embedded Signup. Uses the existing allowlist + `inbound_messages.from_phone`. Ships fastest, matches
  current single-tenancy, **preserves forward-only/allowlist**. The "QR" the user scans is a `wa.me`
  link to the shared bot + an **in-app OTP ceremony** to bind their phone (see §3). This is the real
  near-term product.
- **Phase B (multi-family milestone, only after gates clear): become a Meta Tech Provider**, add
  **Embedded Signup + Coexistence QR** so each family links their OWN Business number — **only after**
  (1) confirming Coexistence supports +972, (2) reconciling forward-only with whole-number ingestion,
  (3) Business Verification + permanent System-User token (#31), (4) #30 re-check at commercial scale.
  Each tenant gets their own Business Portfolio (messaging limits are shared per-portfolio since Oct
  2025) for isolated limits and to contain a ToS strike.

### 2.4 Per-user connections (Google) — designed, unbuilt; storage already multi-tenant-shaped

The credential storage layer is **already multi-tenant-shaped** — the explicit foundation-first bet
(`connections` finding):
- PK `(family_id, provider)`, every query `WHERE family_id = ? AND provider = ?`, `oauth_state`
  `family_id`-bound (`credential-store.ts:95-166`, `schema.ts:90-102,143-150`). **No schema migration
  needed** to go per-user — **only the id source changes**.
- `provider` generalizes to future providers for free; **Gmail + Calendar already share the one
  `(default, google)` credential** via `getValidAccessToken` (`index.ts:55-80`).

The entire gap is **above** the store (no identity model). Per-user connections =
(1) resolve session → `family_id`/`user_id` instead of the constant,
(2) replace the shared `ADMIN_TOKEN` gate with the authenticated session,
(3) replace the designed-but-unbuilt `ALLOWED_GOOGLE_EMAIL` single-email pin with "the connected
email belongs to **this** authenticated user,"
(4) **remove the Phase-8 `family_id==='default'` trip-wire** (designed in `web-google-connect-plan.md
§6 / #110`; **NOT yet in built code** — today the trip-wire IS the constant). Removing it is the act
that clears the **#29 (privacy) / #30 (CASA)** gates,
(5) build the per-user connect UI (`features/connections/ConnectionsView.tsx` is a placeholder with
disabled "בקרוב" buttons, #111/#112 unbuilt).

> **Per-family encryption-key blast radius (gap, P2):** one global `GOOGLE_TOKEN_ENC_KEY` for all
> families is a single point of total compromise across every family's Google account under SaaS.
> Evaluate per-family key derivation (HKDF from a master + `family_id`) or at minimum a key-rotation
> design — `enc_key_version` already exists in the credential row (`schema.ts:125`) to support it.

### 2.5 Message save + display (mostly built; display net-new)

Save is **done** (§1.6). Display mirrors the events board's read path:
- **Store:** add `listRecent(limit): InboundRow[]` to `InboundStore` (`inbound-store.ts:24-39`).
- **Richer outcome (the real value):** the queue's 3-state `status` (`pending|done|failed`) is too
  coarse — allowlist-refused, rate-limited, "text only", unparseable→rephrase, and clarify-thread all
  settle as `done`, **indistinguishable from "became an event."** Add a nullable **`outcome`** column
  (`parsed|clarified|rephrase|refused|rate_limited|text_only`) set at each terminal branch in
  `inbound.ts` (lines ~56,70,79,89,227,235,242). Mirror the idempotent `ALTER TABLE` at `schema.ts:35`.
- **Endpoint:** token-gated `GET /messages` → `{ messages }` (clone `GET /events` at `server.ts:61-70`;
  `deps.inbound` already on `ServerDeps`).
- **Contract:** `inboundMessageSchema` + `inboundMessagesResponseSchema` in
  `packages/shared/src/index.ts` (sibling to `savedEventSchema`).
- **Client/hook/UI:** `fetchMessages` + `useMessages` (clone `fetchEvents`/`useEvents`, 30s poll → or
  Realtime in Phase B); new `MessagesView` reusing `features/ingestion/WhatsAppBubble.tsx`; a
  `/web/messages` route + `הודעות` nav tab.

> **Do NOT reuse `SavedEvent`** — it has no place for raw inbound text, `from_phone`, `received_at`,
> media type, or status, and a non-text/unparseable message has no `SavedEvent` at all. The messages
> feed is its own append-only, read-only resource — the "what did the bot receive and what happened"
> audit/inbox view, complementary to the structured events board.

### 2.6 The Supabase data/auth/RLS/Realtime/billing layer

**Migration shape (driver swap, not interface swap):**
- Add `family_id` to **every** table (`events`, `conversations`, `inbound_messages`; `credentials` +
  `oauth_state` already have it). One column + one **index per `family_id`** per table.
- Make `EventStore`'s 3 reserved `familyId` params real `WHERE family_id = ?`; add `family_id` to the
  5 currently-unscoped methods (`saveEvent`/`listEvents`/`deleteLastFromSender`/`countSince`/
  `deleteByProvider`). **`deleteLastFromSender` and `findEventsByRef` are destructive/cross-row — they
  MUST be family-scoped or they delete/leak across tenants.**
- `ConversationStore`: `UNIQUE (family_id, from_phone)`; add `familyId` to create/getPending/resolve/
  expireStale.
- `InboundStore`: family-scope `pending()`/stats/`countFromSenderSince`. **`wa_message_id` PK
  caveat:** the "globally unique → PK can stay" advice **assumes shared-number routing**. Under Phase-B
  own-number-per-family, Meta may scope IDs per-WABA → PK must become **`(family_id, wa_message_id)`**.
  Resolve this when the onboarding model is chosen (gap P1-#8).
- **Connection:** bot uses **session-mode pooler / small direct pool** (§2.1). Transaction-mode pooler
  is reserved for edge functions only.
- **`SET LOCAL` / no GUC** rule, **app-encrypted credential blobs**, **`(select auth.uid())` wrapped**
  + indexed `family_id` for RLS perf (MakerKit best practices).

**Realtime live board (Phase B):** Postgres Changes / Broadcast-from-DB with RLS on `realtime.messages`
— a client only receives rows its RLS permits. Replaces the 30s `useEvents` poll. **Note:** this is a
web-architecture change with its own at-subscription-time RLS caveats; do not treat it as free.

**Billing (Stripe, net-new, part of #32):**
- Stripe Checkout subscription → **signed, idempotent `whsec_` webhook → `subscriptions` table keyed
  by `family_id`.** Consider Supabase's `stripe-sync-engine`. Web features gate via status; the bot
  checks status before processing.
- **Grace-period vs retention collision (gap P1-#9):** when a card fails (`past_due`→`unpaid`),
  **keep ingesting `inbound_messages` during a short grace window** — do NOT silently drop family
  events the family assumes are captured — but degrade UI/agent. **This retention of a non-paying
  family's Hebrew messages is exactly what the #29 Amendment-13 data-retention policy must govern.**
  Bill grace and privacy retention together, not in isolation.

**EU residency:** create the project in **`eu-central-1` (Frankfurt)** — **irreversible**. Israel has
a 2026 EU adequacy decision (EU↔IL flow without SCCs) — **but this is asserted from practitioner blogs;
confirm against a primary EU Commission source and design a contingency if adequacy lapses** (gap
P1-#6). Adequacy covers transfer mechanics, not Amendment-13 local obligations (#29).

---

## 3. The named pieces wired together — end-to-end flow

The load-bearing addition (gap #1): the **phone↔account binding ceremony**.

```
                         ┌──────────────────────── PHASE A (shippable) ────────────────────────┐

(1) SIGNUP            User → web app → Supabase Auth (email/OAuth)
                         └─ creates auth user (user_id). NO family yet.

(2) CREATE/JOIN      New family?  → INSERT families(family_id) + family_members(user_id, family_id, 'owner')
    FAMILY           Existing?    → accept an INVITE link (token) → family_members(user_id, family_id, 'member')   [#23 track]

(3) PHONE-OWNERSHIP  *** THE BINDING CEREMONY (net-new, security-critical) ***
    PROOF            web app shows: "Forward this code to the bot" OR "we'll text you, reply with code"
                       a. user enters their phone → server stores a PENDING claim (family_id, phone, otp, expires)
                       b. user proves control: forwards the OTP from THAT number to the shared bot
                       c. webhook sees from_phone + OTP body → matches pending claim →
                          INSERT family_phones(family_id, from_phone, verified_at)
                       └─ NOW from_phone is bound to family_id. Unverified claims never resolve. (gap P2-#2)

(4) CONNECTIONS      User → /web/connections → "Connect Google"
                       └─ /oauth/google/connect-url gated by the SESSION (not ADMIN_TOKEN)
                       └─ state.family_id + credentials.(family_id, provider) ← RESOLVED id (not "default")
                       └─ callback pins connected email to THIS user (not a static ALLOWED_GOOGLE_EMAIL)

(5) MESSAGES SAVED   Family forwards a Hebrew message → webhook (ack-then-process)
                       └─ resolver: from_phone → family_phones → family_id   [PRIMARY guard, no RLS backstop]
                       └─ allowlist/forward gate still applies   └─ inbound_messages(family_id, text, …, outcome)
                       └─ parse → events(family_id, …)   └─ conversations(family_id, from_phone) for clarify

(6) DISPLAYED ON UI  Browser → GET /messages + GET /events with USER JWT
                       └─ RLS: family_id IN (SELECT family_id FROM family_members WHERE user_id = (select auth.uid()))
                       └─ MessagesView (raw stream + outcome pill) + EventsBoard (structured) + Realtime (Phase B)

                         └──────── PHASE B adds: Tech Provider + Embedded Signup Coexistence QR at step (3) ───────┘
                                    (own-number-per-family — ONLY after +972 verified & red line reconciled)
```

**The two resolvers that must agree:** bot path `from_phone → family_phones → family_id`; browser path
`auth.uid() → family_members → family_id`. They join at the family. The binding ceremony (step 3) is
what makes `family_phones` trustworthy — and is the single most security-critical new component
(§2.1).

---

## 4. Two tracks: Research → Development

The roadmap splits into a **Research track** (decide / verify / sign-off — *no code*; output is a
written answer) and a **Development track** (build — each milestone tagged with the research it depends
on and the *seams it touches*, so milestones stay decoupled). **Rule: a Development milestone cannot
start until every Research item it depends on is answered.** Nothing ships publicly before the **#26
dogfood month** proves the habit (#32 is gated on it).

### 4.1 Research track (R) — no code, output = a written decision

| R | Question / gate | Status | Unblocks |
|---|---|---|---|
| **R1** | Deployment origin / CORS (G-CORS) | ✅ **RESOLVED → same-origin** (decided 2026-06-20: Hono serves `apps/web/dist`, one origin, no CORS) | D2, D3 (web-facing) |
| **R2** | WhatsApp **Coexistence for +972** + forward-only reconciliation (G-COEX) — *the keystone unknown* | 🔴 OPEN | D9 |
| **R3** | Isolation model (G-ISO): app-layer `family_id` PRIMARY (service_role bypasses RLS); resolver security-critical | 🔴 OPEN | D3, D4, D5 |
| **R4** | Cost & scope (G-COST): is `gmail.readonly` / CASA Tier 2 in scope for v1? + cost-timing ledger | 🔴 OPEN | D6 |
| **R5** | Compliance sign-off: **#29** Israeli privacy · **#30** WhatsApp-policy re-confirm · **#31** go-live verification | 🔴 OPEN | D6, D9 *(public ship)* |

### 4.2 Development track (D) — build, each tagged with its dependencies

| D | Milestone | R-deps | D-deps | Seams touched | Ships on |
|---|---|---|---|---|---|
| **D1** | Durability SPOF (offsite uploader) | — | — | `index.ts`, infra | single-tenant ✅ now |
| **D2** | Messages display | *(R1 ✅)* | — | `inbound-store`, new `/messages`, web | single-tenant ✅ now |
| **D3** | Tenant columns + store scoping | R3 | — | `schema` + **all stores** | SQLite |
| **D4** | Identity + binding ceremony | R3 | D3 | auth, family tables, **11 `FAMILY_ID` sites** | SQLite → |
| **D5** | Supabase migration | R3 | D3, D4 | store drivers | the engine swap |
| **D6** | Per-user connections | R4, R5 | D4 | `oauth-routes`, `credential-store`, web | post-migration |
| **D7** | Billing | R5 (#29) | D4 | new billing, webhook | post-identity |
| **D8** | Realtime board | — | D5 | web data layer | post-migration |
| **D9** | WhatsApp own-number onboarding | **R2** (hard), R5 | D4 | whatsapp onboarding, webhook routing | only if R2 ✅ |

### 4.3 Dependency graph

```
R1 ✅ ─┐
       ├─► D1  (independent, anytime)        D8 ◄── D5
R3 ───►├─► D2  (independent, anytime)         │
       │                                      │
       └─► D3 ──► D4 ──► D5 ──────────────────┘
                   │
         ┌─────────┼──────────┐
         ▼         ▼          ▼
    D6(+R4,R5)  D7(+R5)   D9(+R2,R5)   ← independent of each other
```

### 4.4 Interaction / non-conflict check (do the milestones collide?)

Which milestones touch the **same seams** (→ must coordinate) vs are **disjoint** (→ parallel-safe):

| Pair | Shared seam? | Verdict |
|---|---|---|
| **D1 ↔ everything** | none | ✅ fully independent — build anytime, in parallel |
| **D2 ↔ D3** | `inbound-store` + web data layer | ⚠️ **the one real interaction** — D2 ships a single-tenant `/messages`; D3 later adds `family_id`. **Mitigation:** build D2's contract **tenant-ready** (a `family_id` seam defaulting to `"default"`) so D3 is additive, not a rework |
| **D3 → D4 → D5** | schema → resolver → driver | ✅ clean layering (sequential dependency, not a conflict) |
| **D6 ↔ D7 ↔ D9** | disjoint (oauth vs billing vs whatsapp) | ✅ independent of each other — parallel-safe **after D4** |
| **D8 ↔ rest** | web data layer (post-migration) | ✅ independent after D5 |

**Build order that respects every constraint above:**
1. **Now, in parallel (zero interaction):** D1, D2 *(D2 built tenant-ready)*.
2. **Research gate:** answer **R3** (then R2/R4/R5 as their dependents approach).
3. **The spine (sequential):** D3 → D4 → D5.
4. **Fan out after D4/D5 (mutually independent):** D6, D7, D9 *(D9 only if R2 passed)*; D8 after D5.

The single chokepoint is **D4's phone→family resolver** — every tenant-aware milestone routes through
it, which is *why* it is the security-critical boundary (R3). Keep it one well-tested seam, never
duplicated per milestone.

### 4.5 Milestone detail (exit criteria)

> The research items R2–R5 below were previously framed as "M0 gates"; their detail is in §4.1 + the
> Launch-gates table at the end of this section. The detail below is the **Development** track.

### M1 — Durability SPOF fix (engine-independent; prerequisite for >1 family)
**Exit:** `noopUploader` (`index.ts:154`) replaced by a real offsite `Uploader` → EU R2/B2 with **one
Litestream replica prefix per family file** (Litestream corrupts if two DBs share a prefix), pinned
version, replica-freshness alert. (docs-and-milestones B8 — "the real urgent action, not the engine.")
Makes file-per-family safe at >1 family while still on SQLite.

### M2 — Messages display (low-risk, high-value; ship on current single-tenancy)
**Exit:** `listRecent` + nullable `outcome` column + `GET /messages` + shared contract +
`fetchMessages`/`useMessages` + `MessagesView` + route/nav. No new isolation concern — inherits the
same Phase-8 migration as `events`. Ships the user's "display them" ask **now**, before multi-tenancy.

### M3 — Tenant columns + store-driver scoping (still SQLite; the schema half of isolation)
**Exit:** `family_id` on `events`/`conversations`/`inbound_messages`; `UNIQUE (family_id, from_phone)`;
EventStore's 3 reserved params made real + 5 unscoped methods gain `family_id`; destructive methods
family-scoped; tests prove cross-tenant queries return empty. **This is the HIGH-effort schema work
RLS needs a column to enforce on.** Credential/`oauth_state` already done.

### M4 — Identity model + the binding ceremony (net-new core of #32)
**Exit:** Supabase Auth wired; `families` + `family_members` + `family_phones`; the **phone↔account
binding ceremony** (§3 step 3) with OTP verification; the **resolver** replacing `FAMILY_ID="default"`
at all 11 call sites; `family_id` in `app_metadata` via access-token hook. **Resolver is
security-reviewed + test-gated (no RLS backstop, §2.1).** Invite flow for #23 join-existing-family.

### M5 — Supabase migration (the ONE engine swap)
**Exit:** Supabase Pro in **Frankfurt**; Postgres tables + `family_id` indexes; store drivers swapped
(same interfaces); **RLS policies** (`(select auth.uid())`-wrapped) for browser reads; bot on
**session-mode pooler**; app-encrypted credential blobs preserved; per-family SQLite → Postgres bulk
import (idempotent on `wa_message_id`). **Trigger:** dashboard/Realtime milestone OR 2nd family —
whichever lands first (CONTINUITY). Resolve the `(family_id, wa_message_id)` PK question per the
onboarding model chosen.

### M6 — Per-user connections (generalize the unbuilt Connect-Google)
**Exit:** session-gated `/oauth/google/*`; resolved `family_id` (not the constant); email-pin = "belongs
to this user"; **`family_id==='default'` trip-wire removed**; live `ConnectionsView` (#105–#113).
**GATE #29 + #30:** removing the trip-wire is the act that crosses the 100-user cap / CASA clock —
privacy + WhatsApp-policy sign-off required **before this ships publicly.**

### M7 — Billing (net-new, part of #32)
**Exit:** Stripe Checkout + signed idempotent webhook → `subscriptions(family_id)`; gating on web +
bot; **grace-period policy that keeps ingesting but degrades** (§2.6), reconciled with the #29
retention policy.

### M8 — Realtime board (replaces 30s poll)
**Exit:** Realtime with RLS authorization for the family board + messages feed. Web-architecture change;
validate at-subscription-time RLS.

### M9 — Phase-B WhatsApp onboarding (ONLY if G-COEX passed)
**Exit:** Meta **Tech Provider** registration; **Embedded Signup + Coexistence QR**; per-family
Business Portfolio. **GATE #31:** permanent System-User token + Business Verification + real number +
HMAC `X-Hub-Signature-256` (#9) ON. **GATE #30 re-confirm** at commercial scale (proactive templates /
help affordance edge toward scrutiny). If G-COEX failed, **stay on the shared-number Phase-A model** —
the product is shared-number routing, not own-number bots.

### Launch gates (cross-cutting, before ANY paid/public launch — #32 blocked by these)
| Gate | Issue | Type | Mechanism |
|---|---|---|---|
| Israeli Privacy / Amendment 13 | **#29** | docs + sign-off, no code | consent, data-minimization, **children's data**, retention/**deletion policy**, forward-only+one-file scope-minimizing baseline |
| WhatsApp single-purpose policy | **#30** | written Meta/BSP confirm | no open-domain mode; user data serves only that user; no training on chat; **re-confirm at commercial scale** |
| Go-live | **#31** | prod WhatsApp + HMAC | permanent system-user token; business verification; real number; flip HMAC ON; E2E smoke |
| RLS isolation red line | (G-ISO) | code + test | app-layer `WHERE family_id` PRIMARY; session-mode pooler; no GUC; resolver security-reviewed |

---

## 5. Key decisions + open questions

### Decisions taken in this plan
1. **Split isolation model** (§2.1): app-layer `family_id` is the **primary** write-path guard; RLS is
   browser-read-path only. Resolver is security-critical.
2. **Two-phase WhatsApp onboarding** (§2.3): **shared-number, route-by-`from_phone` near-term**;
   own-number Coexistence QR only in Phase B after +972 + red-line gates clear.
3. **Phone↔account binding ceremony with OTP** (§3) is mandatory before any phone resolves to a family.
4. **Messages display ships now** (M2) on current single-tenancy — decoupled from multi-tenancy.
5. **Stay SQLite until the migration trigger; migrate to Supabase Pro Frankfurt ONCE** (locked;
   re-cited not re-opened).

### Open questions (must resolve at the cited gate)
- **Each-user-own-number vs shared-number** → decided two-phase, but **the Phase-B switch hinges on
  G-COEX (+972 Coexistence availability)**, still unverified. If it fails, own-number is off the table.
- **Deployment origin / CORS (G-CORS)** → unresolved across every prior doc; **decide before M3**.
- **EU adequacy for Israel** → asserted from blogs; confirm against EU Commission primary source; plan
  a contingency if it lapses (gap P1-#6).
- **WhatsApp cost model** → "near-zero at small scale" rests on third-party BSP docs (per-message
  pricing, tier removal, shared-portfolio limits); confirm on Meta first-party before the business plan
  (gap P1-#7).
- **`(family_id, wa_message_id)` PK** → depends on shared- vs own-number; resolve at M5.
- **Per-family encryption key** → evaluate HKDF-from-master vs the single global key under SaaS blast
  radius (gap P2-#11; `enc_key_version` already present).
- **Multi-family admin model** → `adminPhone`/`ADMIN_TOKEN`/digest/ceilings are single-tenant-shaped;
  who is "admin" across N families? (gap P2-#12).
- **Account deletion / right-to-erasure mechanics** → must purge across **five** stores: Postgres rows,
  app-encrypted Google tokens, offsite Litestream replicas, Stripe customer, Supabase Auth user. The
  offsite replica is the easy-to-forget one (gap P2-#10; feeds #29).
- **`events` backfill is lossy-derivable** (no `family_id` today; derive from historical `from_phone`→
  allowlist) — low risk at dogfood scale, but the one table where the column is genuinely absent
  (gap P2-#13).

---

## 6. Risks

### R1 — Cross-tenant leakage (the privacy red line)
The defining red line: "process only forwarded/allowlisted messages — never all chats" (CLAUDE.md).
Under the **service_role-bypasses-RLS** reality, **app-layer `family_id` scoping is the ONLY write-path
guard** — there is no RLS backstop. Concrete leak vectors:
- The **phone→family resolver** mapping a wrong `family_id` (→ make it security-reviewed + test-gated).
- The **`conversations` UNIQUE-on-`from_phone`** collision → two families' colliding phone strings =
  silent cross-tenant pending-thread takeover (→ `UNIQUE (family_id, from_phone)` before 2nd family).
- **Transaction-pooler GUC reuse** leaking a prior family's context (→ session-mode pooler, no `SET`,
  `WHERE family_id = $1` literal).
- **Destructive cross-row methods** (`deleteLastFromSender`, `findEventsByRef`) unscoped (→ family-scope
  before migration).
- **Unverified phone claims** at signup (→ OTP binding ceremony; without it, claiming someone's number
  = trivial cross-tenant read).

### R2 — WhatsApp policy / verification / Coexistence
- **#30 single-purpose:** "likely compliant" is a verdict for the *current* single-family bot.
  Commercializing + a help affordance + proactive template reminders edges toward scrutiny → **re-confirm
  at commercial scale**, don't assume the dogfood posture.
- **Coexistence keystone (Risk 1):** unverified for +972 AND structurally fights forward-only. The QR
  product may be unbuildable as imagined; the fallback is a categorically different (shared-number)
  product. **Verify before promising the UX.**
- **#31:** unverified business portfolios start at **Tier 0 / 250 msgs/24h**; need Business Verification
  + permanent system-user token + real number to scale. One shared number = one quality rating = **one
  ToS strike hits everyone** (a Phase-A acceptance to make explicit).

### R3 — Cost: ≤$100/mo dogfood → paid SaaS economics
The defining constraint is "solo dev, evenings, ≤$100/mo, foundation-first." The SaaS transition hits a
**simultaneous financial + ops cliff** at "2nd paying family" that no finding modeled as a step-function:
- **CASA Tier 2** (`gmail.readonly` restricted): **$500–$1,800/yr, annual, front-loaded** = 6–18 months
  of the entire monthly budget in one lump, **before revenue**. → **G-COST decision: maybe drop/defer
  `gmail.readonly` at first launch to avoid CASA entirely.**
- **Supabase Pro $25/mo mandatory** (free-tier 7-day pause is fatal).
- **Meta Business Verification** + permanent token + real number (#31); **Stripe** fees + dunning logic.
- **Litestream offsite** (R2/B2 bucket + per-family prefix + alert) — unbudgeted ops the solo dev must
  run nightly-safe (M1).
- **Amendment-13 (#29) + sub-processor DPAs + written retention/deletion policy** — legal work, possibly
  paid counsel.
- **Mitigation:** the **gate-cost-and-timing ledger** (G-COST) with annual-vs-monthly timing and a
  break-even family count; decide the budget-ceiling revision **before** committing to CASA-forcing
  scopes. Messaging itself is near-zero (family-initiated forwards stay in the free 24h window) — the
  budget driver is Claude/infra + compliance, not WhatsApp.

---

## Sources & seams (key files / issues)
- **Seams:** `db/schema.ts` (`:135` constant; tables `:9-28/:43-53/:167-187` lack `family_id`),
  `db/event-store.ts` (`:180-197` reserved-ignored `familyId`), `db/conversation-store.ts`
  (`from_phone`-only key), `db/inbound-store.ts` (no tenant filter, no `listRecent`),
  `db/credential-store.ts` (fully tenant-keyed — the model to copy), `config.ts` (`:45,177` single env),
  `core/allowlist.ts` (global list → phone→family resolver), `core/handler/inbound.ts`
  (`:54,145-248` constant call sites), `index.ts` (`:37-49` shared `dbPath`, `:154` `noopUploader`),
  `tools/tools.ts` (`:68-84` `ToolContext.familyId` ready).
- **Docs:** `web-architecture-plan.md` (§6 deploy, §10 CORS), `web-google-connect-plan.md` (§6 hard
  guard, §7 compliance, §10 origin), `conversational-agent-plan.md` (familyId-param seams),
  `google-oauth-plan.md` (`(family_id,provider)` PK + CASA gate), `CONTINUITY_homeOS.md` (DB verdict,
  open questions).
- **Issues:** **#32** (multi-tenant+auth+billing), **#31** (go-live), **#30** (WhatsApp policy),
  **#29** (privacy/Amendment-13), **#26** (dogfood gate), **#23**+closed **#15** (multi-user-in-family),
  Milestone **#10 / #105–#113** (Connect-Google), **#110** (trip-wire), **#9** (HMAC).
- **Research:** Supabase RLS (service_role bypasses RLS), Custom Access Token Hook, MakerKit RLS,
  dev.to SET-vs-SET-LOCAL, Supabase pooling, free-tier 7-day pause, Stripe×Supabase + pause-payment,
  Frankfurt residency + Israel adequacy; Meta Embedded Signup / Tech Provider / Coexistence /
  messaging-limits / per-message pricing; respond.io 2026 AI-policy.
