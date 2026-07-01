<!-- Authored 2026-07-02 via /etk:auto-research → /etk:brainstorm --deep: 1 codebase mapper + 8 parallel
analysis agents (PM, UX, backend, frontend, security, data, testing, sprint) + 3 synthesis agents
(integration, Socratic, coherence). All verdicts code-verified against main @ 6043267. Reconciles and
absorbs the June-2026 P1–P5 design-modernization ladder (P1 dark elevation + P2 de-densify land here;
P3–P5 ride Phase D). Palette PRESERVED: "Warm Paper × Living Green" (DESIGN.md v0.3). -->

# HomeOS — UX Improvement Plan (Daily/Weekly Clarity · Member Lens · Attention Groundwork)

> Make the family board significantly more UX-friendly as a **home-management personal-assistant
> surface**: (1) clear DAILY + WEEKLY views — the LEAD outcome, (2) per-member "שלי" surfacing,
> (3) in-app needs-attention groundwork for future notifications. Same palette, token-first,
> RTL Hebrew first-class. Solo dev, evening-PR slices, dogfood month governs.

## 0. Locked decisions

**Scope (Phase-0 interrogation):**
- Tier SIGNIFICANT, restructure allowed but **incremental** — no big-bang.
- Member lens = **client-side filter on shared data** (no backend visibility model; everyone still sees everything).
- **Daily/weekly clarity leads**; assistant framing and notifications follow.
- Notifications = **in-app surface only** (no push infra yet).

**Product calls (user-refined):**
1. **"שלי" = mine + unassigned.** The lens shows `assignee=me` PLUS unassigned items as a *visually
   distinct third state* (never fully dimmed). Rationale: a dimmed unassigned dentist appointment is
   exactly the miss the lens exists to prevent.
2. **Attention = assistant sentence, not badge.** A quiet one-line Hebrew sentence on Today
   ("נשארו 2 משימות מאתמול") — calm-home aligned; no red rail badge. `deriveAttention`'s output shape
   is designed as *"a message the agent could send"* (kind, event ids, due date — PII-separable), so the
   future proactive agent inherits the same seam.
3. **Week strip = dots + today marker.** Up to 3 small dots per day ("something exists") — calm and
   glanceable. Counts/member-colors can layer in later on dogfood evidence.
4. **Voice = declarative.** "הבא בתור: חוג של נועה ב-16:00" — warm but never first-person; first-person
   invites replies the single-purpose-bot guardrail forbids answering.

**Synthesis conflict resolutions:**
1. Next-Up hero → Phase B tail as a **static** card (S-effort once selectors exist); the signature
   settle-motion (hairline rule draw + card settle) deferred to Phase D.
2. Lens persistence → **v0 = URL param only**; localStorage stickiness is v1 (needs #10 so the device
   knows who "mine" is). Reconciliation rule: URL wins when present; localStorage rehydrates only when
   the param is absent; multi-tab divergence accepted (no storage-event sync).
3. Assignee identity → **client-side matching now**; `assignee_member_id` column deferred to Phase 8
   (member uids are placeholders pre-real-auth — write-time ids would bake in a re-key migration;
   client matching self-heals as the matcher improves).
4. Lens semantics → **highlight/dim (opacity-40, a11y intact), not hide**. A filtered-empty day on a
   shared device reads as "nothing scheduled" — the exact trust failure #7 fixes elsewhere. Hide becomes
   an explicit second toggle state in v1+, if ever.
5. #7 standing visibility is **not pure-FE**: `rowToSaved` drops `standing_until` on the wire
   (verified — `apps/server/src/db/event-store/mapping.ts`), so the additive `standing.until` field
   ships with it.
6. Time-of-day chapters → **cheap subset only**: collapse-past-items on Today. Full בוקר/צהריים/ערב
   chaptering stays Won't this cycle.

**Security constraints (right-sized, three):**
1. The lens is labeled **"תצוגה"** with a one-time honesty hint — "מסנן תצוגה בלבד — כל המשפחה רואה
   את הכל". Never lock/eye iconography, never the word פרטיות. Tripwire: the moment private-to-member
   items, child accounts, or N>1 appear, the backend visibility model becomes mandatory.
2. Attention derives from the **session-gated GET /events payload** — no new aggregate endpoint;
   family-scoped by construction. (Pin with a contract test: the derivation consumes only the /events
   response type and performs no fetch of its own.)
3. Name matching is **exact-or-neutral**: normalized exact match only, never fuzzy (דנה/דני prefix
   collisions); 0 or ≥2 candidates → unmatched, rendered neutral (current hash color), excluded from
   member-lens buckets, never guessed.

## 1. Architecture principle — ride the one poll

Every feature derives from the **existing 30s `GET /events` poll** + `GET /family`. No new endpoints,
no new polls, no materialized state. Total backend work for the whole cycle:

| Change | Where | Notes |
|---|---|---|
| `standing.until` serialized | `savedEventSchema` + `rowToSaved` | `.optional()` inside standingSchema; **never** on `parsedEventSchema` (the POST-widening gotcha) |
| `is_me: boolean` on roster rows | `familyMemberSchema` + GET /family | `.optional().default(false)`; compare `session.email.toLowerCase()` to `member.email?.toLowerCase()`; placeholder/email-less members → `false`, never throw |
| *(optional, evidence-gated)* ETag/304 on the poll | later | only if payload-size evidence appears |

**Shared pure functions in `packages/shared`** (the notification/agent seam — web consumes them now;
a future notifier cron calls the SAME functions and diffs deterministic item keys):
- `isStandingDueOn(event, dayIso)` — standing-due predicate.
- `deriveAttention(events, todayIso) → AttentionItem[]` — zod `attentionItemSchema`, discriminated
  union `overdue | standing_due`, deterministic keys (`overdue:{id}`). **Clarifications are CUT from
  v1** — clarify threads save nothing to events and conversation rows are deleted on resolve (partially
  verified; re-verify before ever adding them).
- `matchAssigneeToMember(assignee, members) → userId | null` — normalize (trim, collapse whitespace,
  strip nikud/cantillation NFD U+0591–U+05C7, applied to BOTH sides), exact-then-alias match,
  ambiguity → null.
- `jerusalemTodayIso()` — **moved from `apps/web/src/shared/lib/date.ts` into `packages/shared`**
  (coherence-critical: web and the digest path must share ONE day-boundary truth; web re-exports).
  Derivation fns take `todayIso`/`now` as explicit params (testability). Residual: a wrong device
  clock still yields the wrong day — acceptable for dogfood, documented.

**SQL/TS equivalence (coherence-critical):** the server's standing-due predicate stays SQL
(`statements.ts`); add a **property/fixture-matrix test** (anchor<today<until, until=today,
anchor=today, null until, non-daily) asserting the SQL result set ≡ the TS `isStandingDueOn` filter
over in-memory SQLite. Without it, "single source of truth" is aspirational.

## 2. Phases (evening-PR sized; each phase ends in one deployable UI-visible batch)

### Phase A — Trust & Clarity (~4 evenings) → deploy
| Slice | Contents |
|---|---|
| A0 (rides A1–A4) | Pin the **EventCard contract test** FIRST (kind-by-form, meta row, done state); `withNow` frozen-clock harness; `shared/lib/event-selectors.ts` skeleton |
| A1 | **#9 dark elevation ladder** — token-only: 3 distinct surface-alpha tiers for `--card`/`--card-muted`/`--chip-bg` (lean on alpha, not shadows, over the night gradient); fix the `--radius-sm` `:root` gap; WCAG AA pass |
| A2 | **#6 week de-densify** [=P2] — cap DayColumn at ~3 cards + "+N עוד" pill (≥44px target, `dir="ltr"` count), subtle today anchor; the cap must never silently truncate |
| A3 | **#1 week strip on Today** — `features/day-view/components/WeekStrip.tsx`, composes `useWeekDays`; 7 cells, dots (≤3) + `aria-current="date"` today; DOM order Sun→Sat, `dir=rtl` places Sunday rightmost (never reverse the array) |
| A4 | **#7 standing visibility** — server: serialize `standing.until`; shared: `isStandingDueOn` + equivalence test; web: `(יומי)` meta marker on EventCard (additive `cadenceBadge?` prop) + "קבוע" group in AnytimeSidebar via SectionHeader |

### Phase B — The Lens Arc (~1.5 weeks) → deploy
| Slice | Contents |
|---|---|
| B1 | **#10 session avatar** — replace hardcoded "מאיה" in AppShell; render through PersonAvatar (referrerPolicy pattern); expose only {name, avatarUrl, email}; alt = name, not email |
| B2 | **`is_me` on GET /family** (server, ~15 LOC + the 3 member-shape tests: real-uid+email, placeholder-email, placeholder-phone) |
| B3 | **#8 matcher** — `matchAssigneeToMember` in packages/shared; Hebrew fuzz corpus; unmatched keeps hash color (visually identical fallback); unmatched-rate telemetry (count only, no names) |
| B4 | **#2 lens v0** — `LensBar` in `shared/board`; chips = PersonChip + `aria-pressed`; state = `?lens=` URL param (TanStack `validateSearch` — garbage values fall back, never throw; `retainSearchParams` across /today↔/calendar); dim others `opacity-40`; **unassigned = distinct third state, never fully dimmed**; honesty hint copy; "הכל" reset |
| B5 | Collapse-past-items on Today (#11-lite) + **#3 hero v0-lite** — static declarative Next-Up card from `selectNextUp` (skips done/past; deterministic tie-break; hides when empty) |

### Phase C — Attention Groundwork (~1 week) → deploy with C2
| Slice | Contents |
|---|---|
| C1 | `deriveAttention` + `attentionItemSchema` in packages/shared (table-driven specs: Asia/Jerusalem day-boundary traps, midnight rollover at 23:59/00:01, done-exclusion, `standing_until` inclusivity PINNED); the no-fetch contract test |
| C2 | **#4-lite** — the assistant sentence on Today ("נשארו 2 משימות מאתמול"), declarative voice, `--attention: var(--coral)` semantic alias used sparingly; no panel, no dismiss persistence, no rail badge |

### Phase D — post-dogfood fence (hard gate: re-triage against the readout)
Hero settle-motion (the ONE signature interaction: hairline rule draws in, card settles) · #5 Day Peek
sheet · full attention inbox + `attention_dismissals` · lens v1 (localStorage stickiness — shared-device
rule: "שלי" on a family-shared session means the owner's items; say so or exclude stickiness there) ·
full chapters · #12 agent presence seam · P3 warm-paper anchors · P4 Heebo/Rubik type+bidi audit ·
P5 micro-patterns · idea backlog (below).

## 3. Testing strategy (condensed)

- **Derivation layer = the high-value target.** Table-driven pure specs with injected `now`:
  `isOverdue` (timed vs untimed, done-exclusion, the UTC-vs-Jerusalem 21:30Z=00:30+1 trap),
  `isStandingDueOn` (until-inclusive semantics pinned), `selectNextUp` (tie determinism).
- **Hebrew matching spec:** exact / whitespace+RTL-mark variants / nikud strip / two-members-shared-prefix
  → null / unmatched → neutral / empty roster.
- **Sentinel-distinct fixtures** (roster names ≠ event assignees unless intended) — the repo's
  spurious-pass gotcha.
- **Lens tests:** dim keeps accessible names (`getByRole` still finds them — the highlight-not-hide
  contract), URL persistence via `createMemoryHistory`, survives refetch, done-toggle keeps lens.
- **Don't test in jsdom:** computed token colors, container queries, dark contrast. Manual real-browser
  pass instead (no headless RTL shots): (1) dark /today with lens active, (2) dense WeekGrid with "+N",
  (3) the attention sentence populated, (4) phone-width hero + strip.
- **Token-only slices (#9) ≈ zero test churn** — by design.

## 4. Success metrics & kill criteria (dogfood-gated)

- **Gate metric: second-adult glance ratio** (glances by the non-organizing partner / total) — target
  >25%. Kill criterion: unmoved after 3 weeks ⇒ the pull-surface hypothesis itself is questioned
  (the WhatsApp-query alternative gets a spike instead of Phase D polish).
- Cheap signals, no analytics infra: one log line on `?lens=` usage (grep weekly) · week-view route hits
  in existing request logs · the week's-end question to the partner: "השבוע, כשרצית לדעת מה מחכה לך —
  לאן פנית קודם?"
- Existing #26 metrics must hold: glance rate steady-or-up post-Phase-A; forwards/day doesn't dip.

## 5. Risks

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| 1 | EventCard regression (most-rendered component; A2/A4/B4/B5 all touch it) | M×H | contract test pinned first; additive optional props only; ONE card-touching PR at a time |
| 2 | Hebrew name-match false positives | H×M | exact-or-neutral; fuzz corpus; show-don't-hide; telemetry on unmatched rate |
| 3 | Lens misread as privacy | M×M | honesty copy; highlight-not-hide; the N>1 tripwire above |
| 4 | Dark-token contrast regressions | M×M | user real-browser pass both themes before merge; "dimmed" vs "past" must not collapse into one visual value — distinct contrast targets |
| 5 | Scope creep vs the dogfood gate | H×H | Phase D is a hard fence; anything M+ effort needs a dogfood-metric justification in the PR |

## 6. Idea backlog (agent-proposed, NOT committed — re-triage at the Phase-D readout)

Load Meter (per-member weekly load pips — theory-of-change unproven: does visibility redistribute or
just document?) · "Who saw this?" seen-state · Sunday Reset weekly card · Evening Handoff (hero →
"מחר בקצרה" after 19:00) · Quiet Hours dimming · landing shimmer on poll-diff new events (the
WhatsApp→board trust loop made visible) · keyboard spine nav (future tablet) · WhatsApp "מה השבוע"
digest reply (tests weekly-clarity on the surface the family already lives in) · roster `aliases`
column (only if unmatched-telemetry demands) · `attention_dismissals` table (the only attention
persistence ever needed) · ETag/304 on the poll · PushPayload lint schema (ids+category only, no
free text — commit before any push infra exists).

## 7. Open questions (carried, not blocking Phase A)

1. Is the partner's non-glancing a UI problem or a habit problem — and should "מה שלי היום?" ultimately
   be a WhatsApp query instead of a web lens? (Both can be true; the lens is the cheap test.)
2. The product day-boundary at night (event at 00:30 — today or tomorrow?) — currently midnight
   Jerusalem; revisit if the family's rhythm says otherwise.
3. When the Today roster card is demoted (Phase D scan-order work), where does the invite affordance
   survive? (It must stay discoverable — it just became real in #280.)
4. `deriveAttention` dismiss semantics when the full inbox ships: per-member or family-shared? (Blocks
   `attention_dismissals` schema; defer until real auth clarifies identity.)
5. The re-key trigger for write-time `assignee_member_id`: real auth? third member? first ambiguity bug?
   Name it when one occurs.

## 8. Provenance

11-agent deep brainstorm, 2026-07-02: codebase mapper → 8 analysts (product, UX, backend, frontend,
security, data, testing, sprint — backend/frontend/security/data verdicts verified against source) →
3 synthesizers (integration, Socratic ×20 questions, coherence review). User-locked calls: scope
(restructure-incremental), lens=filter-on-shared, daily/weekly leads, attention=in-app;
"שלי"=mine+unassigned-third-state, attention=assistant-sentence, strip=dots, voice=declarative.
Absorbs the June-2026 P1–P5 ladder: P1→A1, P2→A2, P3/P4/P5→Phase D.
