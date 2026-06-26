import type { ParsedEvent } from "@homeos/shared";
import { addWallClockHours } from "../core/time.ts";
import type { SavedEvent } from "../db/event-store/index.ts";
import type { CalendarWriteEvent, CalendarWriteTime } from "../google/calendar.ts";
import { getValidAccessToken } from "../google/oauth.ts";
import type { CalendarToolDeps } from "./context.ts";

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

/**
 * #85 — best-effort, idempotent removal of a board event's Google Calendar mirror (the delete sibling of
 * pushSavedEventsToCalendar). Resolves the Google id via the `homeosEventId` private prop (NOT a cached
 * column), deletes it, and NEVER throws: the board is the source of truth, so a token blip or a missing
 * mirror must not fail the `בוטל ✓`. Not connected ⇒ no-op (G25).
 */
export async function deleteFromCalendar(
  boardEventId: number,
  deps: CalendarToolDeps,
  familyId: string,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): Promise<void> {
  let tok: Awaited<ReturnType<typeof getValidAccessToken>>;
  try {
    tok = await getValidAccessToken(familyId, deps);
  } catch (err) {
    log?.("calendar delete: token unavailable", { error: String(err) });
    return;
  }
  if (tok.status !== "ok") return; // not connected → nothing to remove
  try {
    const gid = await deps.client.findEventIdByPrivateProp(
      tok.token,
      deps.calendarId,
      "homeosEventId",
      String(boardEventId),
    );
    if (gid) {
      await deps.client.deleteEvent(tok.token, deps.calendarId, gid);
      log?.("calendar delete: removed mirror", { boardEventId, gid });
    }
  } catch (err) {
    log?.("calendar delete failed", { boardEventId, error: String(err) });
  }
}
