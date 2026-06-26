import { type ParsedEvent, parsedEventSchema, sanitizeUserText } from "@homeos/shared";
import { z } from "zod/v4";
import { addDaysIso, jerusalemDayStartIso, jerusalemWallClock } from "../core/time.ts";
import type { SavedEvent } from "../db/event-store.ts";
import type { CalendarEvent } from "../google/calendar.ts";
import { getValidAccessToken } from "../google/oauth.ts";
import type { Tool } from "./context.ts";

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
