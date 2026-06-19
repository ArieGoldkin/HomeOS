<!-- Generated 2026-06-19 by the conversational-agent-design workflow (10 agents): investigate(6) →
synthesize → adversarial critique (over-engineering + security/single-purpose) → finalize. Grounded in
ATK June-2026 patterns (function-calling, agent-loops, langgraph human-in-the-loop, llm-patterns,
claude-api) + the live code + web research. Locked product decisions: confidence-gated confirm; scope =
cancel-by-reference + edit-in-place + clarify; mirror the DB-as-queue pending→resume primitive, no graph
engine. Milestone: "Conversational events: confidence-gated clarify + cancel/edit by reference". -->

# Conversational Events (#NN) — Design & Build Plan

> Bounded multi-turn ABOUT EVENTS ONLY — clarify / cancel / edit. Never open-domain chat.
> Grafts onto the existing DB-as-queue + handler-driven-destructive-ops seams; no graph engine.
> Folds in two adversarial lenses (over-engineering + security/single-purpose): slim conversation
> row, no premature `gcal_event_id` column, family-scoped destructive lookups, deterministic
> post-parse clarify gate (no `agent.run` contract widening), DELETE-on-resolve single-use.

## 1. Decision summary

- **What:** make the bot *bounded multi-turn about events*. Three capabilities, all on ONE new
  store + ONE new handler resume branch:
  1. **Confidence-gated clarify** — auto-add clear parses (keep the instant magic); when a parse is
     missing a **required slot** (date or title), ask **one** templated Hebrew question, save nothing,
     resume on the answer.
  2. **Cancel by reference** — `"בטל את הפגישה ב-3:30"` → server-side reference extraction → lookup →
     delete a single match (+ best-effort Google delete), or a numbered disambiguation thread.
  3. **Edit / correct in place** — `"שנה את הפגישה ל-4:00"` and the pending-context correction
     `"לא ב-28, ב-21"` → `updateEvent` (+ best-effort Google patch). The correction path fires ONLY
     against a server-held target in an open thread.
- **Why this shape:** the deferred personal-agent-vision memo + agent-core-plan §G12 already named the
  approach — mirror the **proven** `inbound_messages` pending→resume primitive (boot-replay is exactly
  "ask → wait → resume", just for processing). A `ConversationStore` is one SQLite row = one
  "interrupt" checkpoint. **No LangGraph, no graph engine** — stays in TS.
- **Right-sized, not gold-plated** (over-engineering lens): the conversation row is **7 columns**
  (`id, from_phone, kind, payload_json, status, expires_at, created_at`) with a single `payload_json`
  blob holding the per-kind variant — NOT 14 typed columns. **Resolution is a `DELETE`** (single-use,
  matches `oauth_state` at `schema.ts:143`, closes redelivery for free). **No `gcal_event_id`
  column** — the existing `findEventIdByPrivateProp("homeosEventId")` (`tools.ts:367`) already resolves
  the Google id and is the idempotent source of truth. `findEventsByRef` returns matches newest-first;
  **no speculative ranking**.
- **Security/single-purpose is mechanical, not prompt-prayer** (security lens, three BLOCKERS folded):
  (1) the clarify draft is a **deterministic post-parse rule INSIDE `extract_events`** that returns a
  discriminated `{clarify}` arm — the unsaved draft never rides `tool_result` and never re-enters an
  `i>0` auto turn (closes the G7/G17 cliff). (2) Destructive lookups are **family-scoped** (the real
  trust boundary — the board + Google Calendar are SHARED), not `from_phone`-scoped, so parent B can
  cancel parent A's event; `from_phone` stays for provenance + the bare-ביטול undo. (3) The Google
  delete resolves via `findEventIdByPrivateProp` (the push's own idempotent key) and the `בוטל ✓`
  confirms the **board** delete (source of truth) — the Google mirror is best-effort follower lag,
  stated explicitly.
- **RED LINE held as the surface grows:** no `chat` tool; cancel/edit are **handler-level** ops, NOT
  model-callable tools (mirroring `pushSavedEventsToCalendar`); structured-only return (G3) + forced
  turn-0 (G4) on every run incl. resume; all user-facing strings are a fixed set of server-owned
  Hebrew templates; the `AGENT_SYSTEM` "you do not chat" clause (`agent.ts:71`) is retained.

## 2. Architecture — the resume branch in the handler

The outer pipe (webhook → enqueue → `processInbound` → `handleInbound`) is **byte-identical**.
`processInbound` (`handler.ts:305`) gets ONE change: when `handleInbound` sends a clarifying/
disambiguation question, the inbound row is marked **done** (the question was sent; the *conversation*
row — not the inbound row — now carries the open state), so boot-replay never re-asks.

```
webhook ──200──▶ enqueue (idempotent on wa_message_id) ──▶ processInbound ──▶ handleInbound
                                                                                   │
   ┌───────────────────────────────────────────────────────────────────────────────┘
   ▼  (ORDER IS LOAD-BEARING — see G22)
 (1) allowlist gate ───────────────not allowed▶ REFUSAL_HE, return
 (2) G16 per-sender daily rate ────over ceiling▶ RATE_LIMIT_HE, return
 (3) text-only guard ──────────────────no text▶ TEXT_ONLY_HE, return
 (4) expireStale(now)  +  pending = conversations.getPending(from, now)        ← NEW
       if pending ▸ handleResume(pending, text)  ──────────────────────▶ return ← NEW (never agent.run)
 (5) "ביטול" (exact === CANCEL_TRIGGER):                                          ← extended
       if an open thread existed (already resolved in (4) path? no) ▸ … see note
       deleteLastFromSender, confirm, return                           ← never sent to Claude
 (6) "סנכרן מייל"  ▸ gmail sync, return        (UNCHANGED)
 (7) "סנכרן יומן"  ▸ calendar sync, return     (UNCHANGED)
 (8) /^(בטל|מחק|הסר)\s+\S+/   ▸ cancel-by-reference branch, return   ← NEW (after syncs, before G2)
 (9) /^(שנה|ערוך|תקן|עדכן)\s+\S+/ ▸ edit-by-reference branch, return ← NEW
 (10) G2 input-length cap ─────over MAX_INPUT▶ REPHRASE_HE, return    (UNCHANGED)
 (11) saved = agent.run(text, ctx)                                    (UNCHANGED happy path)
        if extract_events flagged a clarify ▸ open clarify thread + send template, return ← NEW
        else formatConfirm + auto-push to Calendar                    (UNCHANGED)
```

**Why this order:** RESUME sits AFTER the rate gate (no ceiling bypass via "answer" spam) and BEFORE
`agent.run` (an answer is never re-parsed as a fresh forward). cancel/edit-by-reference sit AFTER the
sync triggers and BEFORE G2/agent (they are deterministic routes exactly like ביטול). Bare `ביטול`
is the **universal escape hatch**: when a thread is open, it resolves the thread WITHOUT also running
`deleteLastFromSender` (the open op takes precedence — see §4 flow notes, security concern fold).

`handleResume(row, text)` dispatches on `row.kind`:
- `clarify` → merge the answer into the draft (date/time/title slot) → `parsedEventSchema.safeParse`
  → save + confirm + auto-push, or abandon + `REPHRASE_HE` (turn cap = 1).
- `cancel` → a numbered reply (`^\s*[1-5]\s*$`) picks one candidate → `deleteById` (family-scoped) +
  best-effort `deleteFromCalendar` → `בוטל ✓`. Any non-index reply → `REPHRASE_HE`, no delete.
- `edit` → a numbered reply picks one candidate → apply the held patch → `updateEvent` + Calendar
  patch → `עודכן ✓`.

Resolution is a `DELETE … RETURNING` on the conversation row (single-use). A Meta at-least-once
redelivery of the same answer finds no pending row → no-op. The raw answer NEVER enters a
`{type:"auto"}` agent turn — when a re-parse is genuinely needed (e.g. a free-form date answer), it is
a **single forced-tool run** (`forceTool`, `maxIterations:1`, G6-revalidated input), reusing the proven
loop, never an auto loop.

## 3. ConversationStore — interface + SQLite schema

Sibling to `EventStore`/`InboundStore`: same single family SQLite file, same `createXxxStore(dbPath)`
factory + interface pattern (`event-store.ts:62`), WAL, idempotent DDL in `schema.ts`.

```ts
// platform/apps/server/src/db/conversation-store.ts
export type ConversationKind = "clarify" | "cancel" | "edit";

/** The per-kind variant, stored as one JSON blob (over-engineering lens: one column, not 6). */
export type ConversationPayload =
  | { kind: "clarify"; reason: ClarifyReason; draft: ParsedEvent }
  | { kind: "cancel"; candidateIds: number[] }                    // length 1 when pre-resolved
  | { kind: "edit"; candidateIds: number[]; patch: EventPatch };

export interface ConversationRow {
  id: number;
  from_phone: string;        // conversation scope key — one open thread per family member
  kind: ConversationKind;
  payload_json: string;      // JSON ConversationPayload
  status: "pending";         // only pending rows live; resolution DELETEs (single-use)
  expires_at: string;        // SQLite-UTC from the injected clock; TTL config constant (default 30m)
  created_at: string;
}

export interface ConversationStore {
  /** INSERT OR REPLACE on the partial-unique from_phone — opening a new thread overwrites a prior pending one. */
  create(input: { fromPhone: string; kind: ConversationKind; payload: ConversationPayload; expiresAt: string }): ConversationRow;
  /** Returns null if no pending row OR the row is expired (TTL checked at READ time via nowSqlite). */
  getPending(fromPhone: string, nowSqlite: string): ConversationRow | null;
  /** DELETE … RETURNING — single-use; a redelivered answer finds nothing (G24/redelivery). Returns the row or null. */
  resolve(id: number): ConversationRow | null;
  /** Boot sweep + per-inbound sweep: DELETE WHERE expires_at < now. Returns the count. */
  expireStale(nowSqlite: string): number;
}
```

```sql
-- schema.ts, alongside the other CREATE_* constants
CREATE TABLE IF NOT EXISTS conversations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_phone   TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK(kind IN ('clarify','cancel','edit')),
  payload_json TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status = 'pending'),
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- DB-layer enforcement of "at most ONE open thread per sender" (the SQLite analogue of
-- inbound_messages' wa_message_id PRIMARY KEY dedupe). Because resolution DELETEs, only pending
-- rows ever exist, so a plain UNIQUE works; a partial index keeps it explicit.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_pending_per_sender
  ON conversations(from_phone);
```

Notes (folding the critiques):
- **No `gcal_event_id`, `question_he`, `outbound_wa_message_id`, `turns_used`, `resolved_at`,
  `candidate_ids`/`target_id` columns.** `question_he` is reconstructed from the server-owned template
  keyed on `reason`; there is no re-send flow. `turns_used`'s cap-of-1 is a boolean handled by
  presence/absence of the row + the resume merge result. `resolved_at`/audit retention is dropped:
  `DELETE`-on-resolve matches the cited `oauth_state` precedent and **closes redelivery for free**.
- **`expires_at` is checked at READ time** (`getPending`), so a stale "do you mean A or B?" never
  silently captures an unrelated future message.
- **Privacy (security concern fold):** because resolved/expired rows are DELETEd (not retained), the
  table never accumulates abandoned drafts of forwarded third-party text — consistent with the
  project's data-minimization red line. `expireStale` is the retention sweep.

EventStore additions (`event-store.ts:29` interface):

```ts
/** Family-scoped (NOT from_phone): the board + Google Calendar are SHARED — parent B may edit
 *  parent A's event. familyId is the real trust boundary (Phase-8-ready). Re-validates the merged
 *  row via parsedEventSchema before write. source_provider IS NULL only. Returns the updated row or null. */
updateEvent(id: number, patch: EventPatch, familyId: string): SavedEvent | null;
/** Family-scoped delete. Returns the changes count. source_provider IS NULL only. */
deleteById(id: number, familyId: string): number;
/** Family-scoped reference lookup: source_provider IS NULL only, newest-first (ORDER BY id DESC,
 *  the existing listEvents pattern), capped at 5. NO speculative ranking. */
findEventsByRef(familyId: string, ref: { dateIso?: string; time?: string; titleHint?: string }): SavedEvent[];
```

`EventPatch = Partial<Pick<ParsedEvent, "date_iso" | "time" | "location" | "title_he" | "assignee" | "recurrence">>`.
Today `familyId === FAMILY_ID` ("default") maps to the allowlist set, so family-scope = the allowlist;
the `WHERE` clause is `family_id`-ready for Phase 8. The events table has no `family_id` column today,
so the v1 implementation scopes by `from_phone IN (allowlist)` behind the `familyId` parameter — the
**signature is the contract**, documented as the deliberate split: `ביטול` = mine; `בטל <ref>` /
`שנה <ref>` = the family's.

## 4. Conversation flows (Hebrew turns)

### A. Confidence-gated clarify — ask ONE question, then resume

```
User ▸ "פגישה עם הגננת"                       (a title, no date — required slot missing)
  pipeline: allowlist → G16 → text → no pending → no trigger → G2 → agent.run
  extract_events parses; a DETERMINISTIC post-parse rule sees date_iso fell back / is absent →
    returns { clarify: { reason: 'missing_date', draft } }  (saves NOTHING)
  agent.run returns the {clarify} arm (typed 3rd arm) to the handler — draft never touches tool_result
  handler ▸ CLARIFY_QUESTIONS['missing_date'] → conversations.create({kind:'clarify', payload:{reason,draft}})
Bot  ◂ "לא הבנתי את התאריך — מתי זה?"           (server-owned template; no event saved, no confirm)
  processInbound marks the inbound DONE (question sent; conversation row holds open state)

User ▸ "ביום ראשון בשמונה בערב"
  pipeline reaches RESUME: getPending → the clarify row
  handleResume merges the answer into draft.date_iso/time → parsedEventSchema.safeParse
    valid   → events.saveEvent → formatConfirm → auto-push → conversations.resolve (DELETE)
    invalid → conversations.resolve + REPHRASE_HE  (turn cap = 1; the draft is abandoned)
Bot  ◂ "הוספתי ליומן ✓\nפגישה עם הגננת · יום ראשון, 21 ביוני · 20:00"
```

Ignored > TTL: the next message's `expireStale` sweep deletes the row → `getPending` null → that
message is processed as a fresh forward.

### B. Cancel by reference — "בטל את הפגישה ב-3:30"

```
User ▸ "בטל את הפגישה ב-3:30"
  pipeline: … → no pending → ביטול exact-match fails (has a referent) → syncs no-match →
            /^(בטל|מחק|הסר)\s+\S+/ matches → cancel-by-ref branch
  reference extracted SERVER-SIDE by regex: '3:30' → {15:30, 03:30}; remaining text = titleHint (NO model call)
  events.findEventsByRef(FAMILY_ID, ref) — source_provider IS NULL, family-scoped, newest-first, ≤5
    0 → "לא מצאתי אירוע כזה 🤷 נסו עם תאריך/שעה מדויקים"           (no thread, no model)
    1 → deleteById(id, FAMILY_ID) + best-effort deleteFromCalendar → "בוטל ✓"
    N → conversations.create({kind:'cancel', payload:{candidateIds}}); reply a SERVER-built numbered
        Hebrew list with resolved Hebrew dates; mark inbound done
Bot  ◂ "מצאתי כמה אפשרויות:\n1. פגישה · יום שלישי 24 ביוני · 15:30\n2. פגישה · מחר · 03:30\nשלחו 1 או 2"

User ▸ "1"
  RESUME (kind='cancel'): ^\s*[1-5]$ → candidateIds[0] → deleteById + deleteFromCalendar → resolve
Bot  ◂ "בוטל ✓"     (a non-index reply → REPHRASE_HE, no delete — never auto-pick)
```

### C. Edit in place + correction — "שנה ל-4:00" / "לא ב-28, ב-21"

```
EXPLICIT EDIT
User ▸ "שנה את הפגישה ל-4:00"
  /^(שנה|ערוך|תקן|עדכן)\s+\S+/ matches → extract target ref AND field delta from a FIXED vocabulary
    ('לשעה'/'ל-HH:MM'→time, 'למיקום'/'לכתובת'→location, 'ל-DD'→date)
  findEventsByRef → 0 (לא מצאתי) | 1 (apply) | N (open kind='edit' thread, resume on the picked index)
  apply: build full candidate (target row + patch) → parsedEventSchema.safeParse (G1/G20) BEFORE write
    guard source_provider===null: a 'google' row → "אי אפשר לערוך אירוע שמסונכרן מהיומן" (no DB/Cal write)
    updateEvent(targetId, patch, FAMILY_ID) → pushSavedEventsToCalendar([updatedRow])  (best-effort patch)
Bot  ◂ "עודכן ✓\nפגישה · יום שלישי 24 ביוני · 16:00"     (built server-side from the updated SavedEvent)

CORRECTION (only inside an open thread — G20)
User ▸ "לא ב-28, ב-21"
  fires the correction path ONLY when getPending returns an open edit/clarify thread for this sender
    (the server-held target). Outside a pending thread → falls through to normal agent.run (no
    heuristic re-targeting of a past event). Tightened: a correction must be terse and carry NO full
    new event (if the remainder parses as a full new forward, treat it as a new forward, not a
    correction — closes the "לא נשכח את…" false-positive, security concern fold).
  merge into payload.draft (clarify) or held targetId (edit) → safeParse → save/update + Calendar mirror
```

**Bare ביטול while a thread is open** (security concern fold): resolves the thread and replies a
thread-specific "ביטלתי את הפעולה" WITHOUT also running `deleteLastFromSender` (the open op takes
precedence). Only when no thread is open does bare ביטול run the last-message undo.

## 5. Guardrails — G1–G16 PRESERVED; new G17–G24

The single-purpose red line and G1–G16 are **preserved, not re-earned**. The new branches sit INSIDE
that frame; none weakens it. The new IDs are collapsed (over-engineering lens) so each maps to ONE
distinct mechanism.

| # | Guardrail | Mechanism (enforcement layer) |
|---|---|---|
| G1–G16 | **Existing baseline — unchanged** | G1 content-bound schema (`shared/index.ts` `boundedLine`), G2 pre-model input cap (`handler.ts:251`), G3 structured-only return (`agent.ts:173/191`), G4 forced tool turn-0 (`agent.ts:167`), G5 exhaustive `stop_reason` (`agent.ts:180`), G6 re-validate tool input (`agent.ts:133`), G7 `tool_result` is `{saved:n}` count never echoed text (`agent.ts:149`), G8 anchor/from/familyId server-supplied via `ToolContext`, G9 bounded loop, G10 transient/permanent split (`errors.ts`), G15 bidi/RTL sanitize (`isUnsafeCodePoint`), G16 per-sender daily ceiling (`handler.ts:178`). |
| **G17** | **Clarify answer never enters an auto turn (the one real new trust-cliff)** | An open `ConversationStore` row routes the next message to the deterministic RESUME branch, NOT `agent.run`. Resolution is pure-handler (yes/no, HH:MM, numbered pick, date) OR a SINGLE forced-tool run (`forceTool`, `maxIterations:1`, G6-revalidated). The raw answer is never placed into a `{type:"auto"}` loop turn. The clarify draft crosses tool→handler via a typed discriminated arm (`{clarify}`) and is NEVER serialized into any `tool_result` or `messages[]` entry. |
| **G18** | **needs_clarification is a CODE-decided, template-only gate (deterministic post-parse)** | The clarify signal is a **deterministic post-parse rule inside `extract_events`** (date fell back to today / required slot absent), NOT a model-authored question string. `parsedEventSchema` gains a nullable `needs_clarification` carrying a REASON ENUM only. The HANDLER maps the enum → a server-owned Hebrew template (`CLARIFY_QUESTIONS`) and decides ask-vs-save. No template match → `REPHRASE_HE`. Model still returns structured-only (G3/G4 intact); never authors user-facing prose. |
| **G19** | **All new destructive lookups are FAMILY-scoped (the real trust boundary)** | `updateEvent`/`deleteById`/`findEventsByRef` take `familyId` and constrain to the family (today: `from_phone IN (allowlist)`), NOT the single sender — because the board + Google Calendar are SHARED. A reference resolving outside the family → "not found", never a cross-family delete. `from_phone` is retained on the row for provenance and the bare-ביטול undo ("my last message"). Phase-8-ready via the `family_id` predicate. |
| **G20** | **Disambiguation bounded; resume re-validates before write; edits board-rows-only** | `findEventsByRef` returns 0/1/N (N capped at 5); N>1 opens a thread and asks ONE templated "which?" — destructive op fires ONLY on a single resolved candidate, never auto-pick-closest. Every resume merge runs `parsedEventSchema.safeParse` before `saveEvent`/`updateEvent`. Edit/cancel apply ONLY to `source_provider === null` rows; a `'google'` row → "cannot edit/cancel a synced event", no DB/Calendar write (prevents a read→write loop). |
| **G21** | **Correction requires a server-held target; no heuristic re-targeting** | A bare correction (`"לא ב-28, ב-21"`) mutates an event ONLY when `getPending` returns an open edit/clarify thread naming a single target. Outside a pending thread it goes through normal `agent.run`. Tightened: a correction must be terse and carry no full new event (if the remainder parses as a full new forward, it is treated as a new forward). |
| **G22** | **Destructive triggers key off STATE, not message content** | Resume/disambiguation resolution keys off an open row + `msg.from` (server state). Bare `ביטול` stays an EXACT standalone match (`text === CANCEL_TRIGGER`, `handler.ts:200`); cancel-by-ref requires verb + ≥1 further word. Forwarded third-party text containing `'בטל'`/`'כן'`/a time cannot trigger a destructive op unless THIS sender has an open pending op. Pipeline order (§2) is documented as load-bearing. |
| **G23** | **Multi-turn cost ceiling: max 1 clarify round-trip** | A clarify thread allows exactly ONE answer; a second failed merge abandons the op (`resolve` + `REPHRASE_HE`). The cap is enforced by presence/absence of the row (no counter column needed). Clarify answers are ordinary inbound rows already debited by G16 `countFromSenderSince`. To avoid a clarify round-trip stranding a thread when G16 trips, resume-answers are exempted from the G16 increment (they are not new intents — the originating message was already debited), OR a rate-limited resume still resolves/expires the open thread and tells the user — decided + tested in the hardening issue. |
| **G24** | **TTL-at-read + single-pending-per-sender + DELETE-on-resolve + mark-inbound-done** | `expires_at` (~30 min, injected clock) checked at READ time in `getPending`; `expireStale` sweep runs on boot AND before each inbound's resume check; the partial unique index enforces one pending row per sender; resolution is `DELETE … RETURNING` so a redelivered answer is a no-op (mirrors `oauth_state` single-use at `schema.ts:143`). `processInbound` marks the inbound DONE when a question is sent so boot-replay never re-asks. |

**The single-purpose RED LINE** is enforced by the union of: no chat tool added; cancel/edit are NOT
model-callable tools; structured-only return (G3) + forced turn-0 (G4) for EVERY run incl. resume;
clarify/cancel/edit user-facing strings are a fixed set of server-owned Hebrew templates; the
`AGENT_SYSTEM` "you do not chat" clause is retained.

## 6. Command grammar (Hebrew triggers)

| Trigger | Intent | Example |
|---|---|---|
| `ביטול` (exact `text === CANCEL_TRIGGER` — UNCHANGED) | Undo last message's events; if a thread is open, instead resolve the thread (universal escape hatch). Never sent to Claude. | `ביטול` |
| `/^(בטל\|מחק\|הסר)\s+\S+/u` (verb + ≥1 word) | cancel-by-reference: regex-extract date/time/title → `findEventsByRef` → delete single match (+Google delete) or open a numbered thread. | `בטל את הפגישה ב-3:30` |
| `/^(שנה\|ערוך\|תקן\|עדכן)\s+\S+/u` | explicit edit-by-reference: extract target ref + field delta (FIXED vocabulary) → `updateEvent` (+Calendar patch) or disambiguate. | `שנה את הפגישה ל-4:00` |
| terse `/^לא,?\s+(ב-\|ה-\|בשעה\|במיקום)/u` **AND** an open edit/clarify thread | correction-of-pending: merge into the server-held target; outside a thread it falls through to normal parse (G21). | `לא ב-28, ב-21` |
| `^\s*[1-5]\s*$` while a cancel/edit disambiguation thread is open | resume: pick candidate by index → execute on that single event. | `2` |
| any reply while a clarify thread is open (RESUME, deterministic) | resume: merge into the draft slot → `safeParse` → save+confirm, or `REPHRASE_HE`. | `ביום ראשון בשמונה בערב` |
| `סנכרן מייל` / `סנכרן יומן` (exact — UNCHANGED) | existing deterministic provider-sync routes; untouched. | `סנכרן יומן` |

> **Reference-extraction note (over-engineering concern fold):** the verb-prefix regex is the cheap
> *intent router* (is this a cancel/edit at all). For the *reference/field* extraction, the brittle
> Hebrew-regex grammar is the v1 starting point but the documented escape valve is a SINGLE forced-tool
> agent run (`forceTool`, `maxIterations:1`, G6-revalidated) returning a structured `{dateIso?, time?,
> titleHint?}` — the destructive op still fires only after `findEventsByRef` → single-match or a
> numbered pick, so the safety property is unchanged. Tune against real family logs after launch.

## 7. Calendar-sync — delete/patch mirroring (degrade, never throw)

- **Cancel mirror — NEW `CalendarClient.deleteEvent(token, calendarId, eventId)`** (`calendar.ts:64`
  has none today). HTTP `DELETE` to `/calendars/{calId}/events/{eventId}`. **The existing `request()`
  helper (`calendar.ts:139`) calls `res.json()` unconditionally, which throws on a 204** — so add a
  body-less branch (`deleteRequest`) that skips body parse. **404/410 Gone → treat as success**
  (idempotent re-cancel). 429/5xx → `TransientError`; other 4xx → `CalendarApiError` (reuse the
  existing classification at `calendar.ts:132-137`).
- **Cancel flow helper — `deleteFromCalendar(boardEventId, deps.calendar, FAMILY_ID, log)`** — same
  try/catch shape as `pushSavedEventsToCalendar` (`tools.ts:343`). **Resolve the Google id via
  `findEventIdByPrivateProp("homeosEventId", String(id))`** (the push's OWN idempotent source of
  truth) — NOT a cached column. Best-effort, logged, NEVER thrown. Called AFTER `deleteById` succeeds.
  Only `source_provider === null` rows.
- **Edit mirror — NO new client method.** Reuse `pushSavedEventsToCalendar([updatedRow], …)`: its
  `find(homeosEventId) → patch` path (`tools.ts:363-375`) mirrors the edit for free; `homeosEventId =
  String(ev.id)` is stable across the update (the row id never changes).
- **Scope gate:** both mirrors apply ONLY to `source_provider === null` rows (the same filter as
  `pushSavedEventsToCalendar` at `tools.ts:349`) — synced-in `gcal:`/`gmail:` rows are never deleted/
  patched back to Google.
- **Best-effort posture (security blocker fold):** `בוטל ✓` confirms the **board** delete — the source
  of truth. The Google mirror is a best-effort follower; a swallowed Google-delete failure is known
  follower lag, NOT a silent data-integrity claim. A failure never fails the Hebrew confirm and never
  replays the inbound row. Because resolution uses the idempotent `findEventIdByPrivateProp` key, a
  push that failed earlier (id never recorded) does not strand the cancel — the find returns null and
  the delete is a no-op, exactly as a board-only event should behave.

## 8. Model & cost

- **Clear messages are unchanged: still ≈2 Claude calls** (loop `messages.create` + parser's
  `messages.parse`). Confidence-gating ADDS calls only when a parse is genuinely ambiguous: a clarify
  round-trip is +1 inbound (its own ~2 calls on the resume merge if a forced-tool re-parse is used; a
  pure date/time/index merge is **0 extra model calls** — parsed in the handler).
- **Cancel/edit by reference and disambiguation are 0-model-call** in the regex-router v1 (server-side
  extraction); the forced-tool fallback (if enabled) is `maxIterations:1` = 1 call.
- **Cost ceiling held:** clarify capped at 1 round-trip (G23); every inbound debited by G16. Worst
  realistic case (a gan newsletter producing several clarifications in an evening) is bounded by G16,
  not by the new surface. Stays trivially inside ≤$100/mo.
- **Model knob unchanged:** `claude-sonnet-4-6`, swappable via `ANTHROPIC_MODEL`; no new model id.

## 9. File plan

| Path | Change | Purpose |
|---|---|---|
| `platform/apps/server/src/db/conversation-store.ts` | **new** | `ConversationStore` + `createConversationStore(dbPath)` + `ConversationRow`/`ConversationPayload`/`ConversationKind`/`ClarifyReason`/`EventPatch` types. Slim 7-column row; `DELETE`-on-resolve; TTL-at-read. |
| `platform/apps/server/src/db/schema.ts` | **modified** | Add `CREATE_CONVERSATIONS_TABLE` + the partial unique index, alongside the other `CREATE_*` constants. Idempotent (`CREATE TABLE IF NOT EXISTS`). No `gcal_event_id` migration. |
| `platform/apps/server/src/db/event-store.ts` | **modified** | Add `updateEvent`/`deleteById`/`findEventsByRef` (all family-scoped, `source_provider IS NULL` only, prepared statements mirroring `deleteLast` at `event-store.ts:84`). |
| `platform/packages/shared/src/index.ts` | **modified** | Add nullable `needs_clarification: { reason: ClarifyReason }` to `parsedEventSchema`, default null (backward-compatible). Export `ClarifyReason` enum. |
| `platform/apps/server/src/tools/tools.ts` | **modified** | `extract_events`: add the deterministic post-parse clarify rule + a discriminated `{ saved } \| { clarify }` result; do NOT `saveEvent` a flagged event. Add `deleteFromCalendar` helper (best-effort, `findEventIdByPrivateProp` resolve). |
| `platform/apps/server/src/core/agent.ts` | **modified** | Surface the `{clarify}` arm as a typed third return arm of `run` (`SavedEvent[] \| { clarify } \| null`) — additive, the draft never touches `tool_result`/`messages[]`. |
| `platform/apps/server/src/core/handler.ts` | **modified** | Add the RESUME branch + `expireStale` sweep (load-bearing position §2), extend `ביטול` (resolve-open-thread), add cancel-by-ref + edit/correction branches, the `CLARIFY_QUESTIONS` map + server-owned templates, and the clarify-open path after `agent.run`. `processInbound` marks done on question-sent. Add `conversations: ConversationStore` to `HandlerDeps`. |
| `platform/apps/server/src/google/calendar.ts` | **modified** | Add `CalendarClient.deleteEvent` to the interface + `httpCalendarClient`; add a body-less `deleteRequest` (skips `res.json()` on 204); 404/410 → success. |
| `platform/apps/server/src/index.ts` | **modified** | Composition root: `createConversationStore(dbPath)`, wire into `HandlerDeps`, add a startup table-exists assertion (mirrors the credential key canary), run `expireStale` on boot. |
| `platform/apps/server/test/db/conversation-store.test.ts` | **new** | Store unit tests (§10). |
| `platform/apps/server/test/db/event-store.test.ts` | **modified** | `updateEvent`/`deleteById`/`findEventsByRef` tests. |
| `platform/apps/server/test/core/handler.test.ts` | **modified** | Resume, clarify-open, cancel-by-ref, edit, correction-guard, bare-ביטול-resolve tests. |
| `platform/apps/server/test/google/calendar.test.ts` | **modified** | `deleteEvent` 204/404/410/5xx tests. |
| `platform/apps/server/test/integration/flow.test.ts` | **modified** | End-to-end clarify → resume → save; cancel → Google delete; edit → Google patch; boot-replay does not re-ask. |

## 10. Test plan — mocked-loop, in-memory SQLite

**Product-guarantee tests (lock real behavior):**
1. **Clarify gate:** a low-confidence parse (missing date) sends the templated Hebrew question and
   **saves nothing**; a valid answer (RESUME) saves + confirms + auto-pushes; an invalid answer →
   `REPHRASE_HE` and the draft is abandoned (turn cap = 1).
2. **Clarify draft never leaks (G17):** assert the draft string is absent from every `messages[]`
   entry passed to `callModel` and from every `tool_result` content — the draft reaches ONLY the
   handler via the typed `{clarify}` arm.
3. **Cancel single match:** `"בטל את הפגישה ב-3:30"` with one match → `deleteById` (family-scoped) +
   `deleteFromCalendar` called → `בוטל ✓`; **no model call**.
4. **Cancel disambiguation:** two 3:30 events → numbered Hebrew list, **no deletion** until `"1"`;
   a non-index reply → `REPHRASE_HE`, no delete (never auto-pick, G20).
5. **Family scope (G19):** member B cancels/edits member A's event → it deletes/updates locally +
   Google; a row outside the family is never touched.
6. **Edit + correction:** `"שנה את הפגישה ל-4:00"` → `updateEvent` + Calendar patch + `עודכן ✓`;
   `"לא ב-28, ב-21"` with NO pending thread does NOT mutate any event (G21); the false-positive
   `"לא נשכח את יום ההולדת ביום שישי"` with an open thread is treated as a NEW forward (G21 tighten).
7. **Synced-row guard (G20):** an edit/cancel on a `source_provider='google'` row writes nothing to
   DB or Google and replies "cannot edit/cancel a synced event".

**Lifecycle / adversarial tests:**
8. **TTL-at-read (G24):** an expired row → `getPending` null → next message treated as fresh.
9. **Single-use / redelivery (G24/G28):** a redelivered answer (Meta at-least-once) finds no pending
   row after the first resolve → no-op (no double-delete / double-edit).
10. **One-pending-per-sender (G24):** a second `create` for the same sender overwrites the prior
    pending row (partial unique index); two different senders resolve independently.
11. **Boot-replay does not re-ask (G24):** `processInbound` marks the inbound done when a question is
    sent; a boot sweep + replay re-runs nothing.
12. **Bare-ביטול precedence (security fold):** with an open thread, `ביטול` resolves the thread and
    does NOT run `deleteLastFromSender`; with no thread, it runs the undo.
13. **deleteEvent (G25):** 204 → success (no `res.json()` throw); 404/410 → success (idempotent);
    5xx → `TransientError`; deleteFromCalendar never throws.

**Gate:** `pnpm typecheck` (strict) + `pnpm test` green; no network, in-memory SQLite only.

## 11. Build order — small TDD steps, each shippable

1. **ConversationStore + resume branch (foundation)** — store + table + the deterministic RESUME
   branch + `expireStale` sweep, wired at the composition root with a startup table-exists assertion.
   Prove ask→wait→resume end-to-end with a trivial echo-style clarify stub. *Shippable: the primitive
   works before any destructive op lands.*
2. **needs_clarification gate + confidence-gated clarify flow** — the deterministic post-parse rule +
   schema field + `{clarify}` arm + `CLARIFY_QUESTIONS` + the clarify-open + resume-merge path.
3. **Cancel by reference (+ disambiguation, + CalendarClient.deleteEvent)** — fold the
   `deleteById`/`findEventsByRef` EventStore seams AND `deleteEvent`/`deleteFromCalendar` into this PR
   (TDD them here — over-engineering concern: ~10-line methods don't merit standalone PRs).
4. **Edit in place + correction (+ Calendar patch mirror)** — fold `updateEvent` into this PR; reuse
   `pushSavedEventsToCalendar` for the patch; the correction path gated on an open thread (G21).
5. **Hardening / guardrails pass** — G23 rate-interaction decision + test, bare-ביטול-precedence,
   redelivery single-use, TTL config constant, boot-sweep ordering, integration flow.

## 12. Risks & open questions (every critique folded)

**Over-engineering lens:**
- **Conversation row gold-plating → FIXED:** cut to 7 columns with a `payload_json` blob;
  `DELETE`-on-resolve (no retention/audit columns); dropped `question_he`/`outbound_wa_message_id`/
  `turns_used`/`resolved_at`/`candidate_ids`/`target_id`. Re-add a column only when a flow reads it.
- **`gcal_event_id` premature denormalization → FIXED:** dropped entirely; resolve the Google id via
  the existing `findEventIdByPrivateProp` (already used by push, the idempotent source of truth).
- **28 guardrail IDs → FIXED:** collapsed to G17–G24, each mapping to one mechanism; G1–G16 + the red
  line stated as PRESERVED not re-earned.
- **`findEventsByRef` ranking → FIXED:** return matches newest-first (`ORDER BY id DESC`, the existing
  `listEvents` pattern), cap 5, no LIKE-vs-temporal ranking.
- **Regex grammar brittleness → MITIGATED:** verb-prefix regex is the intent router only; the
  documented fallback for reference/field extraction is a single forced-tool run; tune against logs.
- **Six issues → FIXED:** five issues; EventStore seams + `deleteEvent` folded into the cancel/edit PRs.
- **`agent.run` contract widening → FIXED:** the clarify draft crosses via a typed discriminated
  `{clarify}` arm (additive — `null`/`SavedEvent[]` callers mechanically unaffected); never routed
  through `tool_result`.

**Security / single-purpose lens:**
- **Clarify draft escape path (BLOCKER) → FIXED:** deterministic post-parse rule inside
  `extract_events` returns `{clarify:{draftEvent, reason}}`; the draft is never serialized into any
  `tool_result` or `messages[]`; the loop terminates and the draft goes ONLY to the handler. Test 2
  asserts absence from every model message.
- **Cross-member of SHARED events (BLOCKER) → FIXED:** destructive lookups are FAMILY-scoped, not
  `from_phone`-scoped; `from_phone` retained for provenance + bare-ביטול undo. Documented split:
  ביטול = mine; `בטל <ref>`/`שנה <ref>` = the family's.
- **gcal_event_id provenance gap (BLOCKER) → FIXED:** removed the column; `findEventIdByPrivateProp`
  is the primary resolver; `בוטל ✓` confirms the board delete (source of truth), Google mirror is
  best-effort follower lag — stated explicitly.
- **Correction false-positive (`"לא נשכח…"`) → MITIGATED:** correction requires terse text carrying no
  full new event; if the remainder parses as a full forward it is a new forward (G21 tighten). Test 6.
- **G16 vs clarify round-trip stranding → DECIDED in hardening:** exempt resume-answers from the G16
  increment (not new intents), OR a rate-limited resume still resolves/expires the thread and tells the
  user — tested explicitly (G23).
- **Abandoned-thread privacy leak → FIXED:** `DELETE`-on-resolve + `expireStale` retention sweep mean
  no abandoned forwarded-text drafts accumulate.
- **Bare-ביטול double-destructive → FIXED:** with an open thread, ביטול resolves the thread WITHOUT the
  last-message undo (the open op takes precedence). Test 12.

**Open questions:**
- **TTL value:** 30 min (Israeli family evening, delayed delivery) vs 10 min (tighter
  mis-classification). Make it a config constant so tests set 0; product call.
- **Single-match cancel confirm:** instant `בוטל ✓` (instant-magic ethos + ביטול-exists) vs a
  `בטוח?` confirm (irreversibility guidance). Leaning instant for a single exact temporal match.
- **Multi-event correction:** when the last message produced several events, apply a correction only
  when the pending target is a single event, else ask which.
- **Meta enforcement grey area:** confirm templated, domain-bound, bot-initiated clarifying questions
  count as compliant business messaging before scaling clarify frequency; keep templated + minimal.
- **Reference-extraction source:** regex router v1 vs forced-tool re-parse — start with regex, revisit
  against real family logs.
