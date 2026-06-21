# R2 — WhatsApp Coexistence for +972 + Forward-Only Reconciliation (G-COEX)

**Date:** 2026-06-21
**Reference:** R2 #130 — G-COEX (the keystone unknown)
**Context:** Decision input for `docs/design/multi-tenant-plan.md` §2.3 (per-user WhatsApp onboarding verdict) / §4.1 (R2 research track) / §6 (risks). Governs whether deliverable **D9 (WhatsApp own-number onboarding)** is buildable.

---

## Executive Decision

**CONDITIONAL — DO NOT BUILD D9 NOW.** Own-number QR onboarding (Coexistence) for the Israeli (+972) market is **NOT buildable today as the product** and is gated behind one empirical confirmation plus a group-chat dealbreaker check.

**Condition to flip to BUILDABLE:** an affirmative, first-party confirmation that **+972 is enabled for Coexistence** (obtained by either running the actual Embedded Signup Coexistence QR flow with a real +972 WhatsApp **Business App** number, or a Meta support ticket / changelog entry naming Israel) **AND** confirmation that HomeOS does **not** depend on ingesting WhatsApp **group** messages (Coexistence delivers only 1:1 traffic to the webhook).

**Confidence: MEDIUM.** Three first-party facts are decision-grade and solid (Business-App requirement; group chats are NOT delivered; the 2026 Business Solution Terms restrict primary AI/LLM with an EEA/Brazil-only exception that excludes +972). The single load-bearing fact that would make D9 buildable — Israel/+972 Coexistence availability — has **no Meta first-party confirmation** and rests on absence-of-exclusion plus third-party rollout timelines. That gap, plus the group-chat exclusion and the AI-ToS ambiguity, is why the call is conditional, not BUILDABLE.

**Rationale:** Meta enables Coexistence **one country dialing-code at a time** (it launched India-only, later added Nigeria/South Africa) and publishes **no enumerated supported-country list**. So a restriction-free main doc does **not** prove +972 is on. Even if +972 is on, Coexistence only mirrors 1:1 chats — group messages never reach the webhook — which undercuts a group-centric Hebrew family-bot design. The shared-number Phase-A model (§2.3) already ships the real near-term product and sidesteps every one of these unknowns.

---

## Finding 1 — +972 Availability

**Verdict: UNCONFIRMED (the adversarial C1 verdict — "inconclusive" — stands and survives the critic's searches).**

No Meta first-party page names **Israel / +972** as either supported or excluded for Coexistence. What first-party docs *do* establish:

- The current authoritative Coexistence page ("Onboard WhatsApp Business app users," updated 2026-06-16) imposes **NO geographic restriction**. Its Requirements are purely technical (WhatsApp Business app v2.24.17+, Solution Partner / Tech Provider status, Embedded Signup with session logging); its only Limitation is a 20 mps throughput cap. No country, region, EEA, Israel, or +972 appears anywhere on the page. `[Meta first-party]`
- BUT the **Meta changelog proves Coexistence is gated per-country-dialing-code and rolled out incrementally** — it launched for "an India country dialing code" only, then a later entry added "phone numbers from Nigeria and South Africa are now supported." **No entry names Israel/+972.** `[Meta first-party]`

This per-country enablement pattern is decisive: because Meta enables countries individually and publishes no supported-country list, a restriction-free main doc **cannot** be read to imply +972 is on. "Israel = supported" rests on (a) absence-of-exclusion and (b) third-party rollout timelines — not an affirmative Meta statement.

**The GoHighLevel / 360dialog conflict, resolved.** The apparent conflict (some BSP docs implying broad regional exclusions) is **temporal + BSP-rollout-driven, not a Meta platform block on +972**:

- GoHighLevel's **General Availability changelog** (~Mar 18, 2025) listed a broad UNSUPPORTED set (EEA/EU/UK + Australia, India, Japan, Nigeria, Philippines, Russia, South Korea, South Africa, Turkey) — **but Israel was never on it.** This dated snapshot is the source most likely misread as "many regions blocked." `[third-party/BSP]`
- GoHighLevel's **current** support article (last modified Jun 2, 2026) excludes **only Nigeria and South Africa** — no Israel/+972 — confirming the 2025 list was a superseded rollout phase. `[third-party/BSP]`
- **360dialog** gates Coexistence on **business factors** (account tenure, messaging quality, already actively using the Business app), **not geography** — no +972 country block. `[third-party/BSP]`
- A third-party country checker (chakrahq) positively lists "Israel — Full Coexistence Support," with only Nigeria/South Africa unsupported. `[third-party/BSP]` — low-confidence corroboration.

**Which source is authoritative:** **Meta first-party is authoritative**, and it neither confirms nor refutes +972. The BSP docs (GoHighLevel current, 360dialog, chakrahq, ycloud) consistently point to +972 being available, but the earlier "India-only" changelog entry proves blanket "all countries now supported" BSP summaries have been **premature and inaccurate in the past**. Trajectory makes +972 availability **plausible/likely but unproven**. This must be confirmed first-party before any D9 build.

---

## Finding 2 — Red-line Reconciliation

**Question: does HomeOS's forward-only / allowlist red line survive whole-number ingestion under Coexistence?**

**Plainly: the platform does NOT pre-filter inbound 1:1 delivery — the business must filter server-side. But Coexistence is NOT a "full firehose"; the platform DOES exclude whole categories at the platform level (group chats, unsupported companion clients).** This is the corrected read; the adversarial **C2 verdict ("refuted") is correct** and the investigator's "full firehose of inbound messages" framing was wrong on the dimension that matters most.

What reaches the Cloud API webhook under Coexistence:

- **1:1 (individual) inbound** — delivered on the **standard `messages` webhook**, identical to any Cloud API number, with **no platform-side per-contact scoping**. Once linked, every 1:1 message the number receives flows to the webhook going forward. Allowlist/forward-only filtering is **entirely the business's server-side responsibility** (drop non-allowlisted before storage or any Claude call). `[Meta first-party]`
- **Outbound** sent from the Business App is mirrored via the separate `smb_message_echoes` webhook (`from` is always the business number). `[Meta first-party]`
- **GROUP chats are NOT synchronized and NOT delivered to the webhook** — a **platform-side exclusion, not a business choice.** Native Cloud API group support (Oct 2025) is gated to 100,000+ monthly-conversation businesses and **explicitly excluded for Coexistence accounts.** `[Meta first-party]`
- **Unsupported companion clients, disappearing / view-once / live-location** messages are not delivered either. `[Meta first-party]`
- **Past history** is NOT auto-synced: it requires explicit in-app business consent, is a one-time pull within 24h, capped at the most recent 6 months of 1:1 chats (groups never). The business can decline. `[Meta first-party]`

**Does forward-only survive?** Partially, and with a twist:

- **For 1:1 forwards: YES, mechanically.** Coexistence gives no platform allowlist, so server-side filtering is required — which is exactly the architecture HomeOS already runs (allowlist + `inbound_messages.from_phone`). 1:1 Hebrew forwards WILL arrive on the webhook; dropping non-allowlisted before storage/Claude preserves the spirit of the red line.
- **But the red line is about scope, and Coexistence widens it.** Linking a family's whole live number means **all** their 1:1 traffic (not just forwarded messages) reaches the webhook before your code can drop it. That inverts CLAUDE.md's "process only forwarded/allowlisted, never all chats" at the **ingestion** layer even if the **processing** layer stays disciplined.
- **For GROUP-based family coordination: NO.** If HomeOS expects to ingest family **group** messages, Coexistence does **not** support that at all — a potential **NO-BUILD trigger** independent of the +972 question.

**Is server-side allowlist filtering ToS-compliant?** **Unverified by any first-party source.** There is no Meta platform-side per-contact filter, and no Meta source either blesses or forbids the drop-before-storage pattern. It is an architectural assumption, **confirmed-by-absence only** — not a verified ToS-safe posture. Compounding this: the **2026 WhatsApp Business Solution Terms** prohibit AI/ML/LLM as the **primary (rather than incidental/ancillary) functionality**, with the **only** geographic exception being EEA + Brazil country codes — which **excludes +972**. Whether HomeOS's LLM forwarded-message parser counts as "incidental/ancillary" (permitted) vs. "primary AI" (prohibited) is **genuinely ambiguous and load-bearing**, and Meta's Terms give it **no allowlist/server-side-filtering carve-out**. The "structured single-purpose bots are fine" framing is **third-party interpretation, not verbatim Meta text.**

---

## Requirements & Friction

- **Business-App requirement (C3 — SUPPORTED, high confidence, first-party):** Coexistence is built exclusively around the WhatsApp **Business App**. The feature is literally "Onboard WhatsApp Business app users"; Requirements mandate "WhatsApp Business app version 2.24.17 or higher"; using the consumer/personal app is treated as a `BUSINESS_DOWNGRADE` event (a disconnection, not an onboarding path). A **personal** WhatsApp number **cannot** be linked via Coexistence without first migrating to the Business App. `[Meta first-party]`
- **Conversion cost for Israeli families:** the target market uses **personal** WhatsApp. Coexistence therefore requires each family to **first migrate personal → Business App** (and reach v2.24.17+) before scanning the QR — a **conversion-killing prerequisite** for a consumer family product. This friction is structural, not incidental.
- **Embedded Signup / Tech Provider gating:** Coexistence requires being a Meta **Solution Partner or Tech Provider** running **Embedded Signup with session logging**. Whether a solo evening-dev should stand up a full Tech Provider app for a **single +972 number** (vs. routing through a BSP, which re-introduces non-first-party dependency and recurring cost against the $100/mo cap) is **unresolved** and affects practical feasibility more than the country question.
- **Operational caveats (first-party):** Embedded Signup **v2 deprecates Oct 15, 2026** (migrate to v4); the `Deregister` API cannot deregister a number that is in use with both the Business App and Cloud API; 20 mps throughput cap on coexistent numbers.

---

## Shared-number Alternative

If own-number Coexistence is not viable (today's reality), the fallback is the **shared single number YOU own, route by `from_phone`** — already the designed Phase-A product in §2.3:

- **No Embedded Signup, no Coexistence, no Business-App migration.** Provisions a NEW dedicated Cloud API number (standard Embedded Signup path) where families forward to one bot number.
- **Sidesteps every Coexistence limitation:** the +972-Coexistence uncertainty, the group-sync exclusion, the history-sync privacy surface, the personal→Business migration friction, the 20 mps cap, and the v2 deprecation churn.
- **Preserves forward-only/allowlist cleanly** — it uses the existing allowlist + `inbound_messages.from_phone`, matching current single-tenancy and the M1/M2 architecture.
- **Trade-off:** one shared number = one quality rating = **one ToS strike radius** across all families (§6 / Risk). Per-family isolation (separate Business Portfolios) only arrives with the Phase-B own-number model.
- **The "QR" the family scans is a `wa.me` link** to the shared bot plus an in-app OTP ceremony to bind their phone — **not** a Coexistence number-connection. This is a categorically different (and shippable) product from own-number bots.

---

## Citations

**Meta first-party:**

- `https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users` — [Meta first-party], updated 2026-06-16 — Coexistence canonical doc: Business-App requirement (v2.24.17+); Solution Partner/Tech Provider + Embedded Signup w/ session logging; 20 mps cap; **no geographic restriction named**; 1:1 chats mirrored; **group chats "Not supported / will not be synchronized"**; unsupported-companion exception; history 6-month/1:1/one-time/24h opt-in; `BUSINESS_DOWNGRADE`; "Coexistence" = support/partner term for this feature; v2 deprecation Oct 15 2026; Deregister API limitation.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes` — [Meta first-party], 2026-05-21 — outbound Business-App/companion messages mirrored via `smb_message_echoes` (`from` = business number), never inbound.
- `https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog` — [Meta first-party], 2026 — **proves per-country-dialing-code gating**: launched India-only; later "Nigeria and South Africa now supported." **No Israel/+972 entry.** This is the load-bearing reason +972 cannot be inferred from the restriction-free main doc.
- `https://www.whatsapp.com/legal/business-solution-terms/` — [Meta first-party] — 2026 Business Solution Terms: AI/ML/LLM prohibited as **primary** functionality; **only** EEA + Brazil country-code exception (**excludes +972**); no allowlist/server-side carve-out.

**Third-party / BSP (corroborating, NOT authoritative — flagged for first-party confirmation):**

- `https://help.gohighlevel.com/support/solutions/articles/155000003417-whatsapp-coexistence-feature-for-dual-platform-messaging` — [third-party/BSP], last modified 2026-06-02 — current GHL article: only Nigeria/South Africa excluded; no Israel. Resolves the conflict (current state).
- `https://ideas.gohighlevel.com/changelog/whatsapp-coexistence-general-availability` — [third-party/BSP], ~2025-03-18 — the dated broad-exclusion list (EEA/EU/UK + 9 countries); **Israel not on it**. Likely source of the misread "many regions blocked."
- `https://ideas.gohighlevel.com/changelog/whatsapp-coexistence-expanded-global-rollout` — [third-party/BSP], date unknown — "now available across most countries," only Nigeria/South Africa excluded.
- `https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence` — [third-party/BSP], date unknown — eligibility gated on business factors (tenure, quality, active Business-App use), **not geography**.
- `https://chakrahq.com/product/whatsapp/tools/whatsapp-coexistence-support/` — [third-party/BSP], "updated regularly" — checker positively lists "Israel — Full Coexistence Support." Low confidence.
- `https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update` — [third-party/BSP], date unknown — rollout timeline: EU/UK/Russia/Philippines/South Korea ~Nov 2025; South Africa/Nigeria ~Apr 2026; **Israel never named** as supported or excluded.
- `https://respond.io/blog/whatsapp-general-purpose-chatbots-ban` — [third-party/BSP] — interprets permitted "ancillary/structured-task" bots; **does NOT cite Meta's Terms directly** — interpretation only.
- `https://whautomate.com/whatsapp-coexistence` — [third-party/BSP], date unknown — corroborates the three-stream webhook model (messages + smb_message_echoes + history) and real-time mirroring. Secondary confirmation.

---

## Confidence & Residual Unknowns

**Overall confidence: MEDIUM.** Decision-grade first-party facts exist, but the one fact that would unlock D9 is unconfirmed first-party.

**Load-bearing claims with NO Meta first-party source (these LOWER confidence — stated explicitly):**

1. **+972 / Israel IS supported for Coexistence — UNCONFIRMED.** No Meta first-party source names Israel/+972. Rests entirely on absence-of-exclusion in a per-country-gated doc plus non-first-party BSP rollout timelines (ycloud, chakrahq, GoHighLevel). Given Meta enables one dialing-code at a time and publishes no supported-country list, this is the dominant unknown. **This single fact lowers confidence from HIGH to MEDIUM.**
2. **HomeOS's LLM parser qualifies as "ancillary" not "primary AI" under the 2026 Terms — UNCONFIRMED.** The EEA/Brazil-only AI exception explicitly excludes +972; the "structured bots are fine" reading is third-party interpretation, not verbatim Meta text. A genuine compliance risk no first-party source resolves.
3. **Server-side allowlist filtering is ToS-safe under Coexistence — CONFIRMED BY ABSENCE ONLY.** No Meta source blesses or forbids the drop-before-storage pattern; it is an architectural assumption.
4. **Coexistence delivers the messages HomeOS needs — FALSE if HomeOS needs GROUP messages** (first-party-confirmed exclusion). Only 1:1 forwards reach the webhook. Decision-flipping if the family use-case is group-centric.
5. **Inbound MEDIA (voice notes/images) is delivered under Coexistence identically to standard Cloud API — ASSUMED, not first-party-confirmed for the Coexistence path.** Relevant to the M2b voice-note milestone (Whisper).

**First-party-solid (do not re-litigate):** Business-App requirement (C3); group chats not delivered (C2 corrected read); 1:1 inbound on standard `messages` webhook with no platform allowlist; history is opt-in/6-month/1:1/one-time; 2026 Terms restrict primary AI with EEA/Brazil-only exception.

---

## Recommendation

**Make shared-number the product now; do NOT build D9 yet.** Stay on the **Phase-A shared-number, route-by-`from_phone`** model (§2.3) — it ships the real near-term product, preserves forward-only/allowlist cleanly, and sidesteps every Coexistence unknown above. Keep D9 (own-number Coexistence QR) **gated behind R2** in the roadmap.

**Specific next verification steps before ever committing to D9, in priority order:**

1. **Empirically test +972** — run the actual Embedded Signup Coexistence QR flow with a real +972 WhatsApp **Business App** number, OR open a Meta support ticket ("Embedded Signup — Coexistence Onboarding") / watch the changelog for an Israel entry. This is the keystone.
2. **Resolve the group-chat dependency** — confirm whether HomeOS's family use-case requires ingesting WhatsApp **group** messages. If yes, Coexistence is a NO-BUILD regardless of +972.
3. **Get a compliance read** on the primary-vs-ancillary-AI question given there is no +972 exception in the 2026 Terms.

**The single fact that would FLIP the decision to BUILDABLE:** an **affirmative first-party confirmation that +972 is enabled for Coexistence** (a successful real-number QR onboarding of a +972 Business App number, or a Meta changelog/support statement naming Israel). Absent that, own-number is off the table and shared-number is the product.

**The single fact that would flip the decision to hard NOT-BUILDABLE for own-number:** confirmation that HomeOS's core flow **requires ingesting WhatsApp group messages** — Coexistence cannot deliver them, full stop.
