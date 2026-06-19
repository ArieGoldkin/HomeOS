import { type ParsedEvent, parsedEventSchema, sanitizeUserText } from "@homeos/shared";
import { z } from "zod/v4";
import {
  addDaysIso,
  addWallClockHours,
  jerusalemDayStartIso,
  jerusalemWallClock,
} from "../core/time.ts";
import type { EventStore, SavedEvent } from "../db/event-store.ts";
import type {
  CalendarClient,
  CalendarEvent,
  CalendarWriteEvent,
  CalendarWriteTime,
} from "../google/calendar.ts";
import type { GmailClient } from "../google/gmail.ts";
import { type GetTokenDeps, getValidAccessToken } from "../google/oauth.ts";
import type { ParseMessage } from "../parsing/parser.ts";

/**
 * The Gmail seam a connected-provider tool reads (#72), handed in via `ToolContext.google` ONLY on the
 * sync path — so `read_gmail` is inert on a normal forward (G8: capability gated by server context, not
 * the model). Extends `GetTokenDeps` so `getValidAccessToken(familyId, ctx.google)` works directly;
 * adds the read client + the cost/scope clamps (server-owned, never model-chosen).
 */
export interface GmailToolDeps extends GetTokenDeps {
  client: GmailClient;
  /** Hard cap on emails fetched+parsed per sync run (cost ceiling, §6). */
  maxMessages: number;
  /** Server-side recency clamp baked into every query, e.g. "newer_than:7d". */
  queryWindow: string;
  /** Allowlist the model's optional `label` hint is clamped into (empty = no label filtering). */
  allowedLabels?: readonly string[];
}

/**
 * The Calendar seam a connected-provider tool reads (#18), handed in via `ToolContext.calendar` ONLY on
 * the `סנכרן יומן` sync path — so `read_calendar` is inert on a normal forward (G8). Extends
 * `GetTokenDeps` so `getValidAccessToken(familyId, ctx.calendar)` works directly; adds the read client +
 * the server-owned read clamps (which calendar, how far ahead, how many — never model-chosen).
 */
export interface CalendarToolDeps extends GetTokenDeps {
  client: CalendarClient;
  /** Which calendar to read (server-owned; config default "primary"). */
  calendarId: string;
  /** How many days ahead to read (`timeMax = now + windowDays`). */
  windowDays: number;
  /** Hard cap on events fetched per sync run (cost ceiling, §6). */
  maxEvents: number;
}

/**
 * Server-supplied context handed to a tool's `run` — NEVER taken from the model's tool input.
 * This closes the date-spoof / sender-impersonation surface (G8): forwarded text cannot move the
 * Asia/Jerusalem anchor or impersonate a family member. `from` is also the #14 first-person→assignee
 * source (added when direct commands land).
 *
 * A tool persists its OWN rows through `events` (#71 contract change): the tool owns its idempotency
 * key + provenance, which the flattened agent loop can't carry. `familyId` keys the credential a
 * connected-provider tool reads (today the single-family `FAMILY_ID`). The `google?` Gmail seam is
 * added by #72 alongside `read_gmail`.
 */
export interface ToolContext {
  /** Today in Asia/Jerusalem (YYYY-MM-DD), for relative-date resolution. */
  todayIso: string;
  /** Sender phone — server-supplied, never model-supplied. */
  from: string;
  waMessageId: string;
  /** The sender's family-member name (from the MEMBERS map), if known — first-person → assignee (#14). */
  senderName?: string;
  /** The family whose data/credentials a tool acts on (today: the single-family `FAMILY_ID`). */
  familyId: string;
  /** Persistence seam — tools save their own events here (#71); the handler no longer persists. */
  events: EventStore;
  /** Gmail seam for `read_gmail` (#72) — set by the handler ONLY on the sync path; absent → tool no-ops. */
  google?: GmailToolDeps;
  /** Calendar seam for `read_calendar` (#18) — set by the handler ONLY on the `סנכרן יומן` path; absent → no-op. */
  calendar?: CalendarToolDeps;
}

/**
 * The declarative registry seam: a tool is `{ name, description, inputSchema, run }`. Appending a
 * Tool to the array passed to `createAgent` registers it — there is no separate registry layer.
 * `inputSchema` is re-validated against the model's (untrusted) tool input before `run` (G6).
 *
 * `run` returns the rows it PERSISTED (`saved`), not raw events: the tool stamps its own idempotency
 * key + `source_provider`, so per-tool provenance survives the agent loop's flattening (#71/§1).
 */
export interface Tool<I = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  run(input: I, ctx: ToolContext): Promise<{ saved: SavedEvent[] }>;
}

/**
 * Defense-in-depth cap on the model-echoed text (the authoritative cap is the handler's pre-model
 * input cap, G2). Generous vs the handler's MAX_INPUT so a legitimate forward isn't double-rejected.
 */
const MAX_TOOL_TEXT = 8000;

/**
 * The only tool for #13: re-runs the existing extractor (`parser.ts`) so the proven retry/validation/
 * TransientError seam — and its test net — is preserved verbatim. `parse` throwing a TransientError
 * propagates out (→ the agent loop → handler → row stays pending).
 *
 * #71: persists each parsed event itself under the inbound's own key — `waMessageId`/`seq` exactly as
 * the handler did before, `source_provider` left null (a forward, not a provider-derived row) — so
 * behaviour is identical; the one `saveEvent` line just moved down a layer.
 */
export function extractEventsTool(parse: ParseMessage): Tool<{ text: string }> {
  return {
    name: "extract_events",
    description:
      "Extract calendar items (events, tasks, reminders) from the forwarded family message text.",
    inputSchema: z.object({ text: z.string().min(1).max(MAX_TOOL_TEXT) }),
    async run({ text }, ctx) {
      const events = await parse(text, ctx.todayIso, ctx.senderName);
      // One message → several events, each under its own seq (idempotent on (wa_message_id, seq)).
      const saved = (events ?? []).map((event, seq) =>
        ctx.events.saveEvent(event, { fromPhone: ctx.from, waMessageId: ctx.waMessageId, seq }),
      );
      return { saved }; // empty list = "nothing to schedule"
    },
  };
}

/**
 * Compose the Gmail search `q` SERVER-side (G8): the recency window is always applied; the model's
 * optional `label` hint is honoured only if it's in the configured allowlist; `fromSender` is
 * sanitised to a safe address charset + bounded. The model can never issue an arbitrary search.
 */
export function buildGmailQuery(
  input: { label?: string; fromSender?: string },
  deps: { queryWindow: string; allowedLabels?: readonly string[] },
): string {
  const parts = [deps.queryWindow];
  if (input.label && deps.allowedLabels?.includes(input.label)) parts.push(`label:${input.label}`);
  if (input.fromSender) {
    const safe = input.fromSender.replace(/[^A-Za-z0-9._@+-]/g, "").slice(0, 128);
    if (safe) parts.push(`from:${safe}`);
  }
  return parts.join(" ");
}

/**
 * The Gmail tool (#72): on the deterministic `סנכרן מייל` sync intent, read the family's OWN recent
 * matching emails and extract calendar items from them via the SAME `parse` path. Read-only.
 * - Opt-in / app-only → `ctx.google` absent OR `getValidAccessToken` not "ok" ⇒ `{ saved: [] }` with
 *   ZERO Gmail and ZERO parse calls (the AC: app-only families are completely untouched).
 * - Idempotency (AC4): each row persists under `waMessageId="gmail:<id>"` so a re-run upserts the same
 *   rows as no-ops. Provenance: `sourceProvider:"google"` activates #61's disconnect purge.
 * - Result is the COUNT of saved rows; email bodies never re-enter the model loop (G7).
 */
export function readGmailTool(parse: ParseMessage): Tool<{ label?: string; fromSender?: string }> {
  return {
    name: "read_gmail",
    description:
      "Read the family's own recent matching emails and extract calendar items (events, tasks, reminders) from them.",
    inputSchema: z.object({
      label: z.string().max(64).optional(),
      fromSender: z.string().max(128).optional(),
    }),
    async run(input, ctx) {
      const g = ctx.google;
      if (!g) return { saved: [] }; // not wired / not the sync path → no-op, zero calls
      const tok = await getValidAccessToken(ctx.familyId, g);
      if (tok.status !== "ok") return { saved: [] }; // not connected → ZERO Gmail/parse calls
      const q = buildGmailQuery(input, g);
      const refs = await g.client.list(tok.token, q, g.maxMessages);
      const saved: SavedEvent[] = [];
      for (const ref of refs) {
        const msg = await g.client.get(tok.token, ref.id);
        // Subject carries the event as often as the body; cap to the parser's bound (G2 spirit).
        const text = `${msg.subject}\n${msg.bodyText}`.slice(0, MAX_TOOL_TEXT);
        const events = await parse(text, ctx.todayIso, ctx.senderName);
        (events ?? []).forEach((event, seq) => {
          saved.push(
            ctx.events.saveEvent(event, {
              fromPhone: ctx.from,
              waMessageId: `gmail:${ref.id}`,
              seq,
              sourceProvider: "google",
            }),
          );
        });
      }
      return { saved };
    },
  };
}

// The board-side bounds (mirror parsedEventSchema in @homeos/shared) used when mapping directly-typed
// provider text. The safeParse backstop below is the authority; these just pre-trim before validation.
const MAX_TITLE = 80;
const MAX_LOCATION = 120;
const MAX_SOURCE = 2000;

/** Collapse whitespace, strip G15 codepoints (no model in the path → sanitize, don't reject), trim. */
function cleanLine(s: string): string {
  return sanitizeUserText(s.replace(/\s+/g, " ")).trim();
}

/**
 * Map a Google Calendar event straight to a board `ParsedEvent` (#18) — no model in the path, so the
 * mapper owns content-binding (G1/G15): sanitize the user-typed summary/location, bound the lengths, and
 * anchor the date/time to Asia/Jerusalem (AC3 — an all-day event keeps its `date`; a timed event's
 * RFC3339 `dateTime` is read as the Jerusalem wall-clock, no UTC drift). Returns `null` to SKIP an event
 * with no usable title, no/invalid start, or one that still fails the schema backstop — one bad event
 * never poisons the batch (G9 spirit).
 */
export function mapCalendarEvent(ev: CalendarEvent): ParsedEvent | null {
  if (ev.status === "cancelled") return null;
  const title_he = cleanLine(ev.summary).slice(0, MAX_TITLE);
  if (!title_he) return null; // an untitled calendar block isn't a board event

  let date_iso: string;
  let time: string | null;
  if (ev.start.dateTime) {
    const d = new Date(ev.start.dateTime);
    if (Number.isNaN(d.getTime())) return null; // unparseable dateTime → skip
    const wc = jerusalemWallClock(d);
    date_iso = wc.dateIso;
    time = wc.time;
  } else if (ev.start.date) {
    date_iso = ev.start.date; // all-day: already a Jerusalem calendar day, no time
    time = null;
  } else {
    return null; // neither timed nor all-day → unmappable
  }

  const loc = ev.location ? cleanLine(ev.location).slice(0, MAX_LOCATION) : "";
  const candidate: ParsedEvent = {
    kind: "event",
    title_he,
    date_iso,
    time,
    location: loc || null,
    assignee: null,
    recurrence: null,
    source_text: [ev.summary, ev.location, ev.description]
      .filter(Boolean)
      .join(" · ")
      .slice(0, MAX_SOURCE),
  };
  // Backstop: anything the pre-trim missed (e.g. an impossible date) fails here → skip, never store malformed.
  const parsed = parsedEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Empty input schema — the model supplies nothing for a calendar sync (G6/G8: no token, id, or range). */
const CALENDAR_INPUT = z.object({});

/**
 * The Calendar read tool (#18, chunk 1): on the deterministic `סנכרן יומן` sync intent, read the
 * family's OWN upcoming Google Calendar events and add them to the board. Read-only; no model call —
 * calendar data is already structured, so `mapCalendarEvent` shapes it directly.
 * - Opt-in / app-only → `ctx.calendar` absent OR `getValidAccessToken` not "ok" ⇒ `{ saved: [] }` with
 *   ZERO calendar calls (AC6: app-only families are completely untouched).
 * - Idempotency (AC4): each row persists under `waMessageId="gcal:<id>"` so a re-run upserts the same
 *   rows as no-ops. Provenance: `sourceProvider:"google"` activates #61's disconnect purge.
 */
export function readCalendarTool(): Tool<z.infer<typeof CALENDAR_INPUT>> {
  return {
    name: "read_calendar",
    description: "Read the family's upcoming Google Calendar events and add them to the board.",
    inputSchema: CALENDAR_INPUT,
    async run(_input, ctx) {
      const c = ctx.calendar;
      if (!c) return { saved: [] }; // not wired / not the sync path → no-op, zero calls
      const tok = await getValidAccessToken(ctx.familyId, c);
      if (tok.status !== "ok") return { saved: [] }; // not connected → ZERO calendar calls
      const now = c.now?.() ?? new Date();
      const evs = await c.client.list(tok.token, {
        calendarId: c.calendarId,
        timeMin: jerusalemDayStartIso(now), // from the start of today (Jerusalem), not "right now"
        timeMax: addDaysIso(now, c.windowDays),
        maxResults: c.maxEvents,
      });
      const saved: SavedEvent[] = [];
      for (const ev of evs) {
        const pe = mapCalendarEvent(ev);
        if (!pe) continue; // unmappable/cancelled — skip, keep going
        saved.push(
          ctx.events.saveEvent(pe, {
            fromPhone: ctx.from,
            waMessageId: `gcal:${ev.id}`,
            seq: 0,
            sourceProvider: "google",
          }),
        );
      }
      return { saved };
    },
  };
}

// 0=Sunday … 6=Saturday (the board's weekday convention) → the iCal RRULE BYDAY token.
const RRULE_BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const JERUSALEM_TZ = "Asia/Jerusalem";

/**
 * Map a board `ParsedEvent` to a Google Calendar write body (#18 chunk 2 — the inverse of
 * `mapCalendarEvent`). Timed events carry a local `dateTime` + `timeZone: "Asia/Jerusalem"` so Google
 * anchors them with no UTC drift (AC3); all-day events use `date` with an exclusive next-day end. A
 * weekly board recurrence becomes an `RRULE`. `extendedProperties.private.homeosEventId` is the stable
 * idempotency key (AC4) — a re-push finds + patches the same Google event instead of duplicating it.
 * Inputs are already content-bound (the event passed `parsedEventSchema` upstream), so no sanitize here.
 */
export function mapToCalendarWrite(ev: ParsedEvent, homeosId: string): CalendarWriteEvent {
  let start: CalendarWriteTime;
  let end: CalendarWriteTime;
  if (ev.time) {
    const endWc = addWallClockHours(ev.date_iso, ev.time, 1); // default 1h duration
    start = { dateTime: `${ev.date_iso}T${ev.time}:00`, timeZone: JERUSALEM_TZ };
    end = { dateTime: `${endWc.dateIso}T${endWc.time}:00`, timeZone: JERUSALEM_TZ };
  } else {
    start = { date: ev.date_iso };
    end = { date: addWallClockHours(ev.date_iso, "00:00", 24).dateIso }; // exclusive next-day end
  }
  const out: CalendarWriteEvent = {
    summary: ev.title_he,
    start,
    end,
    extendedProperties: { private: { homeosEventId: homeosId } },
  };
  if (ev.location) out.location = ev.location;
  if (ev.source_text) out.description = ev.source_text;
  if (ev.recurrence?.freq === "weekly") {
    out.recurrence = [`RRULE:FREQ=WEEKLY;BYDAY=${RRULE_BYDAY[ev.recurrence.weekday]}`];
  }
  return out;
}

/**
 * Auto-push board-originated events to the family's Google Calendar (#18 chunk 2). Called by the handler
 * AFTER the board save + Hebrew confirm, so it is strictly best-effort: the board is the source of truth,
 * and a failed push is logged, NEVER thrown — it must not fail the user's confirm or replay-loop the row.
 * - Only `source_provider === null` rows are pushed (AC5: `gcal:`/`gmail:`-derived rows are never written
 *   back — that would loop a calendar read straight back to the calendar).
 * - App-only / not-connected ⇒ zero writes (AC6). Idempotent per `homeosEventId` (find → patch | insert, AC4).
 */
export async function pushSavedEventsToCalendar(
  saved: SavedEvent[],
  deps: CalendarToolDeps,
  familyId: string,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<{ pushed: number }> {
  const board = saved.filter((e) => e.source_provider === null);
  if (board.length === 0) return { pushed: 0 };

  let tok: Awaited<ReturnType<typeof getValidAccessToken>>;
  try {
    tok = await getValidAccessToken(familyId, deps);
  } catch (err) {
    // A transient token refresh blip must not fail the confirm; skip the push this round.
    log?.("calendar auto-push: token unavailable", { error: String(err) });
    return { pushed: 0 };
  }
  if (tok.status !== "ok") return { pushed: 0 }; // not connected → no writes

  let pushed = 0;
  for (const ev of board) {
    try {
      const homeosId = String(ev.id);
      const body = mapToCalendarWrite(ev, homeosId);
      const existing = await deps.client.findEventIdByPrivateProp(
        tok.token,
        deps.calendarId,
        "homeosEventId",
        homeosId,
      );
      if (existing) await deps.client.patchEvent(tok.token, deps.calendarId, existing, body);
      else await deps.client.insertEvent(tok.token, deps.calendarId, body);
      pushed++;
    } catch (err) {
      log?.("calendar auto-push failed", { id: ev.id, error: String(err) });
    }
  }
  return { pushed };
}
