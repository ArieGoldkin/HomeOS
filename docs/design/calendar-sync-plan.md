# Google Calendar Two-Way Sync (#18) — Design Plan

> A two-way Google Calendar tool. **Read** (chunk 1): a WhatsApp command ("סנכרן יומן") makes the
> agent call a new read-only `read_calendar` tool that maps the family's upcoming calendar events
> directly into board events (no NL parse — calendar data is already structured), anchored to
> Asia/Jerusalem and tagged `source_provider:"google"` for #61's disconnect-purge. **Write** (chunk 2):
> a forwarded event that lands on the board is auto-pushed to the family's Google Calendar.
> Foundation-first, opt-in, TDD/strict-TS, ≤$100/mo.

Status: **proposed** · Depends on: #59 (OAuth client), #60 (routes/config), #61 (provider purge),
#71 (tool-persists contract), #72 (Gmail tool — the template) · Tier: **SIGNIFICANT** (new module +
the first *write*-to-provider path, grafted onto existing seams)

---

## 0. Decisions taken before this doc (locked)

| Decision | Choice | Why |
|---|---|---|
| **Scope / chunking** | **Read-first, then write** (two PRs) | Read mirrors Gmail #72 exactly (low risk, ships value fast). Write is the *novel* board→provider path → its own gate. |
| **Write trigger** (chunk 2) | **Auto-push every forwarded event** | No extra command; the board *is* the family calendar. (Supersedes the open "auto-add vs always-confirm" question in this direction.) |
| **Write id mapping** (chunk 2, AC4) | Google `extendedProperties.private.homeosEventId` | **Zero local schema change** (the #17/#71 principle); Google becomes the dedupe authority — re-push finds + patches the existing event by our id. |
| **Conflict rule** (chunk 2, AC5) | Provenance source-of-truth, **no bidirectional merge** | *Board-originated* events: board wins (we PATCH the calendar copy). *Calendar-originated* events: read-only mirror, never written back. Simple to document + enforce. |

This doc specifies **chunk 1 (read)** in full and sketches **chunk 2 (write)** in §9.

---

## 1. Problem & why read is (almost) free

We want a family member to send a Hebrew command in WhatsApp ("סנכרן יומן" = "sync calendar") and have
the agent read their upcoming Google Calendar events and surface them on the board (`GET /events`, AC2),
correctly anchored to Asia/Jerusalem (AC3), idempotent so a re-run updates rather than duplicates (AC4),
and completely inert for app-only families (AC6).

The persistence contract wrinkle that Gmail (#17) had to solve is **already solved** — #71 moved
persistence into the tool layer (`Tool.run → { saved: SavedEvent[] }`, the tool owns its idempotency key
+ `source_provider`). So read-calendar needs **no contract change**: it's a new client + a new tool + a
new deterministic command route + config + wiring. Pure addition.

**The one thing that differs from Gmail:** a calendar event is *already structured* (summary, start,
location), so `read_calendar` does **not** call Claude. It maps the Google JSON straight to a
`ParsedEvent`. That makes it cheaper and deterministic, but shifts a responsibility onto us that the
parser handled for Gmail:

- **Validation / content-binding (G1/G15).** The parser produced schema-valid, content-bound
  `ParsedEvent`s. The calendar mapper must do the same itself: **strip** G15 unsafe codepoints from the
  model-untrusted summary/location (a user-typed Hebrew title can legitimately carry directional marks —
  we *sanitize*, not *reject*, so a real event is never silently dropped), truncate to the schema bounds,
  then `parsedEventSchema.safeParse` as a backstop (an event that still fails → skipped + logged, never
  stored malformed).

To keep the G15 codepoint set a single source of truth, `@homeos/shared` exports a `sanitizeUserText`
helper next to the existing `hasUnsafeChars` predicate (same codepoints; one detects, one strips).

### Idempotency: synthetic `wa_message_id = "gcal:<eventId>"` (no schema change)

Exactly the Gmail trick (§1 of `gmail-ingestion-plan.md`): the events table already has
`UNIQUE(wa_message_id, seq)` + an idempotent upsert. Read-calendar persists each row under
`wa_message_id = "gcal:<googleCalendarEventId>"`, `seq` per mapped event. Re-running "סנכרן יומן" upserts
the same `("gcal:<id>", seq)` rows as no-ops (AC4, read side). With `singleEvents=true` each occurrence of
a recurring event arrives as its own stable id, so each instance is its own discrete dated row — no weekly
`recurrence` reconstruction needed. `source_provider:"google"` is set independently of the prefix so #61's
`deleteByProvider("google")` purges both `gmail:` and `gcal:` rows on disconnect.

---

## 2. Guardrails (read-calendar honours all of them)

| Guardrail | How read-calendar honours it |
|---|---|
| **🔒 Allowlist** (G1) | Unchanged — "סנכרן יומן" arrives as a normal inbound WhatsApp message and passes the same allowlist gate before the agent runs. Calendar content is never an entry point. |
| **🚫 Single-purpose** (policy) | The tool only *mirrors the family's own calendar onto the board*. No chat, no open-domain. `AGENT_SYSTEM` names the third capability explicitly. |
| **Input cap** (G2) | The command is tiny. The calendar fetch is bounded by `maxEvents` (cost ceiling, §6); each event's summary/location are sliced to the schema bounds. **No email-body-sized payload** ever exists here. |
| **Forced first turn** (G4) | Turn 0 forces `read_calendar` for the sync intent (the handler routes deterministically, exactly like `ביטול`/`סנכרן מייל`); a forward still forces `extract_events`. The invariant holds. |
| **Tool input re-validation** (G6) | `read_calendar`'s `inputSchema` is `z.object({})` — the model supplies **no** input at all (no token, no calendar id, no query). Nothing to spoof. |
| **Tool result is a count** (G7) | The dispatch result stays `{ saved: n }`. Calendar summaries never re-enter the model loop as instructions. |
| **Server-supplied context** (G8) | `familyId`, the access token, the calendar id, and the time window are all **server-side** (`ctx.calendar` deps + config). The model cannot choose a family, a token, a calendar, or a range. |
| **Programming vs transient** (G10) | The calendar client reuses `errors.ts`: 429/5xx/network → `TransientError` (row stays `pending`, boot-replays); 4xx → permanent `CalendarApiError` (degrade, no replay-loop). |
| **Per-sender daily ceiling** (G16) | The command counts as one inbound against the sender's daily ceiling; `maxEvents` bounds per-run work. Two independent cost bounds. |
| **Opt-in / app-only = zero calls** (AC6) | No credential row ⇒ the handler replies "connect first" and the tool returns `{ saved: [] }` with **zero** calendar calls; `getValidAccessToken` short-circuits with zero network. App-only families are untouched. |
| **Read-only** (chunk 1) | The chunk-1 client implements `list` only — no insert/patch/delete endpoint exists in the code until chunk 2. |
| **Content-binding** (G1/G15) | The mapper strips G15 codepoints + truncates to schema bounds + `safeParse` backstop (see §1). A malformed event is skipped, never stored or rendered. |
| **Secret-scanner-aware** | Mirror `gmail.ts`: bearer from a `[name, value]` tuple, token never logged. |

---

## 3. Architecture (chunk 1 — read)

```
WhatsApp: "סנכרן יומן"
   │  (normal inbound — allowlist G1, ceiling G16, persist-before-ack)
   ▼
handler.handleInbound
   │  deterministic command check (sibling to ביטול / סנכרן מייל): text === SYNC_CAL_TRIGGER?
   ├── no  ─────────────► existing paths (forward → extract_events, סנכרן מייל → read_gmail)
   └── yes ─────────────► not connected? → reply "connect first", ZERO calls
                          else agent.run(SYNC_CAL_INTENT, ctx{calendar})  { forceTool: "read_calendar" }
                                │  turn 0 forces read_calendar (G4)
                                ▼
                          read_calendar tool.run({}, ctx)
                                │
                 1. getValidAccessToken(ctx.familyId, ctx.calendar)   // #59 seam
                 │     ├── not "ok" → return { saved: [] }   (ZERO calendar calls)
                 │     └── ok: token
                 2. timeMin = Jerusalem start-of-today; timeMax = +CALENDAR_WINDOW_DAYS
                    calendarClient.list(token, { calendarId, timeMin, timeMax, maxResults })
                 3. for each calendar event (≤ maxEvents):
                 │     pe = mapCalendarEvent(ev)        // Google JSON → ParsedEvent (Asia/Jerusalem), or null
                 │     if (pe) ctx.events.saveEvent(pe, {
                 │        fromPhone: ctx.from,
                 │        waMessageId: `gcal:${ev.id}`,  // idempotency namespace (AC4)
                 │        seq: 0,
                 │        sourceProvider: "google",      // #61 purge tag
                 │     })
                 4. return { saved }
                                ▼
                          agent returns SavedEvent[] | null  →  handler: formatConfirm(saved) → Hebrew confirm
```

Disconnect (existing, #61): `POST /disconnect/google` already purges every `source_provider:"google"` row
— `gcal:` rows included, no new wiring.

### New module: `google/calendar.ts` (lean `node:fetch`, pure wire — mirrors `gmail.ts`)

```ts
export interface CalendarEventTime { date?: string; dateTime?: string; } // all-day vs timed (RFC3339)
export interface CalendarEvent {
  id: string;
  summary: string;
  location?: string;
  description?: string;
  start: CalendarEventTime;
  status?: string;            // "cancelled" instances are filtered out
}
export interface CalendarListOpts { calendarId: string; timeMin: string; timeMax?: string; maxResults: number; }
export interface CalendarClient { list(token: string, opts: CalendarListOpts): Promise<CalendarEvent[]>; }
export class CalendarApiError extends Error { constructor(code: string, status: number) {...} }
export function httpCalendarClient(fetchImpl?: typeof fetch): CalendarClient;
```

- `list` → `GET /calendar/v3/calendars/{calendarId}/events?timeMin=…&timeMax=…&maxResults=…&singleEvents=true&orderBy=startTime`
  (Bearer token). `singleEvents=true` expands recurring series into dated instances (each its own stable id);
  `orderBy=startTime` requires it. Maps `items[]` → `CalendarEvent[]`, dropping `status === "cancelled"`.
- Errors: reuse the `gmail.ts` `getJson` shape verbatim — 429/5xx/network → `TransientError`; 4xx →
  `CalendarApiError`. The token is handed in by `getValidAccessToken`, so no clock / no credential access.

### Domain mapping: `mapCalendarEvent` (pure, in `tools/tools.ts`, exported for tests)

```ts
export function mapCalendarEvent(ev: CalendarEvent): ParsedEvent | null;
```

| Field | Source | Rule |
|---|---|---|
| `kind` | — | always `"event"` (a calendar entry) |
| `title_he` | `ev.summary` | `sanitizeUserText` (strip G15) → trim → slice(80); **empty ⇒ skip (null)** |
| `date_iso` | `start.date` \| `start.dateTime` | all-day: `start.date` verbatim. timed: Asia/Jerusalem calendar day of `new Date(start.dateTime)` (DST-aware, **no UTC drift**, AC3) |
| `time` | `start.dateTime` | timed: Asia/Jerusalem `HH:MM`. all-day: `null` |
| `location` | `ev.location` | `sanitizeUserText` → slice(120); empty ⇒ `null` |
| `assignee` | — | `null` (no member mapping from a raw calendar; richer later) |
| `recurrence` | — | `null` (`singleEvents=true` → discrete instances; nothing to reconstruct) |
| `source_text` | summary/location/description | bounded slice(2000) |

Returns `null` (⇒ the tool skips it) when the event is cancelled, has no usable title, has neither
`date` nor `dateTime`, or fails the final `parsedEventSchema.safeParse` backstop. The Asia/Jerusalem
wall-clock extraction reuses a new `jerusalemWallClock(date)` helper in `core/time.ts` (alongside the
existing DST-aware offset math).

### New tool: `read_calendar` in `tools/tools.ts`

```ts
export function readCalendarTool(): Tool<Record<string, never>> {
  return {
    name: "read_calendar",
    description: "Read the family's upcoming Google Calendar events and add them to the board.",
    inputSchema: z.object({}),                       // model supplies nothing (G6/G8)
    async run(_input, ctx) {
      const c = ctx.calendar;
      if (!c) return { saved: [] };                  // not wired / not the sync path → zero calls
      const tok = await getValidAccessToken(ctx.familyId, c);
      if (tok.status !== "ok") return { saved: [] }; // not connected → ZERO calendar calls
      const now = c.now?.() ?? new Date();
      const evs = await c.client.list(tok.token, {
        calendarId: c.calendarId,
        timeMin: jerusalemDayStartIso(now),
        timeMax: addDaysIso(now, c.windowDays),
        maxResults: c.maxEvents,
      });
      const saved: SavedEvent[] = [];
      for (const ev of evs) {
        const pe = mapCalendarEvent(ev);
        if (pe) saved.push(ctx.events.saveEvent(pe, {
          fromPhone: ctx.from, waMessageId: `gcal:${ev.id}`, seq: 0, sourceProvider: "google",
        }));
      }
      return { saved };
    },
  };
}
```

### The `ctx.calendar` seam (sibling to `ctx.google`)

`read_gmail` reads `ctx.google` (`GmailToolDeps`). Rather than overload that, add a sibling
`ctx.calendar?: CalendarToolDeps` — the lowest-risk move (read_gmail + its tests stay untouched), mirroring
exactly how the Gmail seam was added in #72.

```ts
export interface CalendarToolDeps extends GetTokenDeps {  // shares oauthClient + credentials + now + log
  client: CalendarClient;
  calendarId: string;   // server-owned (config, default "primary")
  windowDays: number;   // how far ahead to read (cost/relevance clamp)
  maxEvents: number;    // hard cap on events fetched per sync (cost ceiling)
}
export interface ToolContext { /* …existing… */ calendar?: CalendarToolDeps; }
```

The handler wires `ctx.calendar` ONLY on the `סנכרן יומן` path (the G8 gate — `read_calendar` is inert on
any other message).

---

## 4. Error handling (reuses `errors.ts` classification verbatim)

| Situation | Behaviour | Why |
|---|---|---|
| Family not connected | Handler replies "connect first"; tool returns `{ saved: [] }`. **Zero** calendar calls. | Opt-in AC6; degrade-never-throw. |
| Credential revoked (`invalid_grant`) | `getValidAccessToken` self-heals (deletes cred → not_connected); tool returns empty. | Implemented in #59. |
| Calendar 429 / 5xx / network blip | `TransientError` → agent → handler leaves the inbound row `pending` → boot-replay retries; user gets "try again". | A blip must replay, not vanish (same posture as `read_gmail`). |
| Calendar 401/403 (token rejected mid-run) | Permanent → "sync failed" reply, row settles failed; partial `saved` already persisted (idempotent, re-run completes). | No replay-loop on a permanent error (G10). |
| One event unmappable (no title / bad date / fails safeParse) | `mapCalendarEvent` → `null`; that event contributes 0 rows, the run continues. | One bad event doesn't poison the batch (G9 spirit). |
| Programming bug | Rethrown permanent (G10) → row failed, visible, never replayed. | `errors.ts` `isProgrammingError`. |

---

## 5. Key decisions (resolved)

1. **Direct map, no Claude call.** A calendar event is already structured; running it through the NL parser
   wastes model calls and risks mangling a clean date. *Rejected:* reuse the `read_gmail` parse path. The
   cost is that the mapper must own validation/content-binding (§1) — handled by sanitize + truncate +
   `safeParse` backstop.
2. **Sibling `ctx.calendar` seam** (not overloading `ctx.google`). Lowest blast radius — read_gmail and its
   tests are untouched. *Rejected:* a unified `ctx.google` carrying both sub-bundles (more churn, no benefit
   for one family).
3. **Synthetic `wa_message_id = "gcal:<id>"`** for idempotency (no schema change), as Gmail did. *Rejected:*
   a `provider_event_id` column + index.
4. **`singleEvents=true`** so recurring series become discrete dated instances with stable ids — no weekly
   `recurrence` reconstruction, and each instance is independently idempotent.
5. **Deterministic command routing** ("סנכרן יומן" in the handler, like `ביטול`/`סנכרן מייל`) — preserves G4
   and avoids a model round-trip just to classify intent.
6. **`sanitizeUserText` in `@homeos/shared`** so the G15 codepoint set has one source of truth (detect +
   strip), rather than duplicating the ranges in the server.

---

## 6. Config & cost (≤$100/mo)

New settings (only consulted when the `GOOGLE_*` bundle is configured, like `GMAIL_*`):

| Var | Default | Purpose |
|---|---|---|
| `CALENDAR_MAX_EVENTS` | `20` | Hard cap on events fetched per sync run. |
| `CALENDAR_WINDOW_DAYS` | `30` | How far ahead to read (`timeMax = now + N days`). |
| `CALENDAR_ID` | `primary` | Which calendar to read (server-owned; never model-chosen). |

Read-calendar makes **no model calls at all** (direct map), so its only cost is one bounded Calendar API
call per sync (≤ `maxEvents` items), and the per-sender daily ceiling (G16) bounds how often a sender can
trigger it. Comfortably within budget.

---

## 7. File plan (chunk 1)

| File | Change | LOC (est) |
|---|---|---|
| `packages/shared/src/index.ts` | **add** `sanitizeUserText` (strips the G15 codepoints; `hasUnsafeChars` refactored to share the predicate) — purely additive export | ~12 |
| `apps/server/src/google/calendar.ts` | **new** — `CalendarClient` + `httpCalendarClient` (`list`, item map, cancelled filter, error classify) | ~110 |
| `apps/server/src/core/time.ts` | **add** `jerusalemWallClock(date) → {dateIso,time}`, `jerusalemDayStartIso(now)`, `addDaysIso(now,n)` (reuse the existing offset math) | ~25 |
| `apps/server/src/tools/tools.ts` | **add** `mapCalendarEvent` + `readCalendarTool` + `CalendarToolDeps`; extend `ToolContext` with `calendar?` | ~70 |
| `apps/server/src/core/handler.ts` | **add** `SYNC_CAL_TRIGGER` route (sibling to `סנכרן מייל`); `HandlerDeps.calendar?` | ~35 |
| `apps/server/src/core/agent.ts` | extend `AGENT_SYSTEM` to name `read_calendar` | ~2 |
| `apps/server/src/config.ts` | `CALENDAR_MAX_EVENTS`, `CALENDAR_WINDOW_DAYS`, `CALENDAR_ID` | ~10 |
| `apps/server/src/index.ts` | build `CalendarToolDeps` when `config.google`; register `readCalendarTool()`; thread `calendar` into the handler deps | ~14 |
| `apps/server/env.example` | document the three `CALENDAR_*` vars | ~4 |
| **Tests** | `test/google/calendar.test.ts` (list + error classify), `test/tools/tools.test.ts` (mapCalendarEvent TZ all-day/timed/DST + sanitize + skip; read_calendar opt-in zero-call, idempotency key, provenance), `test/core/handler.test.ts` (סנכרן יומן routing + not-connected), `test/core/time.test.ts` (wall-clock), shared sanitize test | ~230 |

**No DB schema change** (the `gcal:<id>` namespace + `source_provider` + `deleteByProvider` are reused) and
**no OAuth change** (`calendar` scope is already in `GOOGLE_SCOPES`). Strongest signals the design is
foundation-first.

---

## 8. Build order (chunk 1 — this PR)

> Each step keeps `pnpm test` + `pnpm typecheck` + biome green; no live network/Claude (mock `fetchImpl`,
> in-memory SQLite). TDD, strict TS.

1. **`sanitizeUserText` in shared** (red→green) — the canonical G15 stripper.
2. **`core/time.ts` helpers** (`jerusalemWallClock` / `jerusalemDayStartIso` / `addDaysIso`) — the AC3 core,
   tested against all-day, timed, and a DST boundary.
3. **`google/calendar.ts`** client — `list` + error classify, against a mocked `fetchImpl` (mirrors the
   `gmail.test.ts` cases).
4. **`mapCalendarEvent` + `readCalendarTool` + `ctx.calendar`** — mapping edge cases, opt-in zero-call,
   `gcal:<id>` idempotency, `source_provider` provenance.
5. **Handler `סנכרן יומן` route + config + `index.ts` wiring + `AGENT_SYSTEM`** — routing, not-connected
   reply, transient → pending; register the tool only when Google is configured.

---

## 9. Chunk 2 sketch — write (board → Google Calendar), for the next PR

> Auto-push: when `extract_events` persists a forwarded event, also create it on the family's Google
> Calendar. This is the first *write* path to a provider.

- **New scope already present** (`calendar` is read/write). Client gains `insert` + `patch` (+ a `list` by
  `privateExtendedProperty` to find existing mappings) — still lean `node:fetch`.
- **Idempotent write (AC4):** on insert, set `extendedProperties.private.homeosEventId = <board id>`; on
  re-push, `list?privateExtendedProperty=homeosEventId=<id>` → if found, `patch` instead of `insert`. Google
  is the dedupe authority ⇒ **no local schema change**.
- **Mapping (AC1):** `ParsedEvent` → Google event. All-day when `time` is null (`start.date`); timed
  otherwise (`start.dateTime` + `timeZone: "Asia/Jerusalem"`, AC3, **no UTC drift on the round-trip**).
- **Conflict (AC5):** board-originated events ⇒ board wins (PATCH the calendar copy on change);
  calendar-originated rows (`gcal:`-sourced, from chunk 1) are **never** written back — a read-only mirror.
  Documented rule, mechanically enforced by checking the row's origin before any write.
- **Trigger (locked):** auto on every forwarded `extract_events` save. App-only families ⇒ `ctx.calendar`
  absent ⇒ no write (AC6). A write failure must **not** fail the WhatsApp confirm — the board save is the
  source of truth; a transient push is retried, a permanent one logged (the row already exists locally).
- **Cost:** one write call per new/changed board event; bounded by the existing G2/G16 inbound limits.

---

## 10. Acceptance criteria → coverage map

| AC | Chunk | Covered by |
|---|---|---|
| Parsed event written to Google Calendar (title/date/time/location) | 2 | `insert`/`patch` mapping (§9) |
| Existing calendar events surface on the board via `GET /events` | **1** | `read_calendar` → `saveEvent` → existing read seam (§3) |
| Dates/times round-trip to Asia/Jerusalem (all-day vs timed, no UTC drift) | **1** (read) / 2 (write) | `jerusalemWallClock` mapping (§3) + `timeZone` on write (§9) |
| Duplicate handling — stable mapping, re-sync updates not duplicates | **1** (read) / 2 (write) | `gcal:<id>` upsert (§1) + `extendedProperties` dedupe (§9) |
| Conflict rule documented + applied | 2 | provenance source-of-truth (§9, §0) |
| App-only families → no calendar reads/writes | **1** + 2 | `getValidAccessToken` zero-call + `ctx.calendar` gate (§2, §3) |
