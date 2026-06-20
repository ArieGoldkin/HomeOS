import { TransientError } from "../core/errors.ts";

/**
 * The Google Calendar surface in one file (#18): a lean `node:fetch` client (the house pattern —
 * mirrors `google/gmail.ts` and `google/oauth.ts`, no `googleapis` SDK). Chunk 1 added `list` (read);
 * chunk 2 adds `insertEvent`/`patchEvent`/`findEventIdByPrivateProp` (the board→Calendar auto-push).
 * There is no delete endpoint here — disconnect-purge is local-only (#61).
 *
 * Error classification reuses `errors.ts`: 429/5xx + network blips → `TransientError`; 4xx →
 * `CalendarApiError` (permanent → degrade, never replay-loop). The bearer header is built from a
 * [name, value] tuple so the repo's secret-scanner doesn't misread it, and the token is never logged.
 *
 * The token is handed in by `getValidAccessToken` (#59) — this client never touches the credential
 * store and does no token math, so it needs no clock. `singleEvents=true` expands a recurring series
 * into discrete dated instances (each its own stable id), so the reader never reconstructs recurrence.
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars";

/** all-day events carry `date` (YYYY-MM-DD); timed events carry `dateTime` (RFC3339 with offset). */
export interface CalendarEventTime {
  date?: string;
  dateTime?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  location?: string;
  description?: string;
  start: CalendarEventTime;
  status?: string;
}

export interface CalendarListOpts {
  /** Which calendar to read — server-owned (config), never model-chosen (G8). */
  calendarId: string;
  /** RFC3339 lower bound (inclusive): the start of today in Jerusalem. */
  timeMin: string;
  /** RFC3339 upper bound (exclusive recency clamp): now + window. */
  timeMax?: string;
  /** Hard cap on events returned (cost ceiling, §6). */
  maxResults: number;
}

/** A write-side time: all-day (`date`) or timed (`dateTime` as a local wall-clock + `timeZone`). */
export interface CalendarWriteTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The body sent to Google on insert/patch (#18 write). `extendedProperties.private` carries our id. */
export interface CalendarWriteEvent {
  summary: string;
  location?: string;
  description?: string;
  start: CalendarWriteTime;
  end: CalendarWriteTime;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarClient {
  list(token: string, opts: CalendarListOpts): Promise<CalendarEvent[]>;
  /** Create an event; returns Google's assigned id. */
  insertEvent(token: string, calendarId: string, ev: CalendarWriteEvent): Promise<{ id: string }>;
  /** Update an existing event in place (board-wins on a re-push, AC5). */
  patchEvent(
    token: string,
    calendarId: string,
    eventId: string,
    ev: CalendarWriteEvent,
  ): Promise<{ id: string }>;
  /** Find an event by a private extended property (`key=value`) — our idempotency lookup (AC4). */
  findEventIdByPrivateProp(
    token: string,
    calendarId: string,
    key: string,
    value: string,
  ): Promise<string | null>;
  /**
   * #85 — delete an event by id. IDEMPOTENT: 404/410 (already gone) is success, so a re-delivered cancel
   * never errors; a 204 carries no body (so it must not be JSON-parsed). 429/5xx → TransientError, 4xx →
   * CalendarApiError, like the rest of the client.
   */
  deleteEvent(token: string, calendarId: string, eventId: string): Promise<void>;
}

/** A permanent (4xx) Calendar API failure — e.g. 401 `Invalid Credentials` / 403. Caller degrades. */
export class CalendarApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`calendar api error: ${code} (${status})`);
    this.name = "CalendarApiError";
  }
}

/** Bearer (+ JSON content-type for writes) as [name, value] tuples — secret-scanner-safe. */
function authHeaders(token: string, json = false): Array<[string, string]> {
  const h: Array<[string, string]> = [["Authorization", `Bearer ${token}`]];
  if (json) h.push(["Content-Type", "application/json"]);
  return h;
}

/** A raw Calendar API item (every field optional — the API omits empty ones). */
interface CalendarItem {
  id?: string;
  summary?: string;
  location?: string;
  description?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
}

export function httpCalendarClient(fetchImpl: typeof fetch = fetch): CalendarClient {
  // One request path for GET (read/find) and POST/PATCH (write). A body ⇒ JSON content-type.
  async function request(
    method: string,
    url: string,
    token: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: authHeaders(token, body !== undefined),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      // Network-level failure → transient (retryable), NOT permanent — a blip must never look like a
      // rejected token to the caller (which would then wrongly degrade to app-only). Mirrors oauth.ts.
      throw new TransientError("calendar network error", err);
    }
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`calendar endpoint ${res.status}`);
      }
      const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new CalendarApiError(b.error?.message ?? "calendar_error", res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  // #85 — a body-less DELETE: a 204 carries NO body (parsing it would throw), and 404/410 means the
  // event is already gone → idempotent success (a re-delivered cancel must not error). Same transient/
  // permanent split as `request`, just no `res.json()` on the happy path.
  async function deleteRequest(url: string, token: string): Promise<void> {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "DELETE", headers: authHeaders(token, false) });
    } catch (err) {
      throw new TransientError("calendar network error", err);
    }
    if (res.ok || res.status === 404 || res.status === 410) return; // 204 / already-gone → done
    if (res.status === 429 || res.status >= 500) {
      throw new TransientError(`calendar endpoint ${res.status}`);
    }
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new CalendarApiError(b.error?.message ?? "calendar_error", res.status);
  }

  const eventsUrl = (calendarId: string) =>
    `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events`;

  return {
    async list(token, opts) {
      const params = new URLSearchParams();
      params.set("timeMin", opts.timeMin);
      if (opts.timeMax) params.set("timeMax", opts.timeMax);
      params.set("maxResults", String(opts.maxResults));
      params.set("singleEvents", "true"); // expand recurring series into discrete dated instances
      params.set("orderBy", "startTime"); // requires singleEvents=true
      const json = await request(
        "GET",
        `${eventsUrl(opts.calendarId)}?${params.toString()}`,
        token,
      );
      const items = (json.items ?? []) as CalendarItem[];
      return items
        .filter((it) => it.status !== "cancelled") // dropped/declined instances aren't board events
        .map((it) => ({
          id: String(it.id ?? ""),
          summary: it.summary ?? "",
          location: it.location,
          description: it.description,
          status: it.status,
          start: { date: it.start?.date, dateTime: it.start?.dateTime },
        }));
    },

    async insertEvent(token, calendarId, ev) {
      const json = await request("POST", eventsUrl(calendarId), token, ev);
      return { id: String(json.id ?? "") };
    },

    async patchEvent(token, calendarId, eventId, ev) {
      const url = `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`;
      const json = await request("PATCH", url, token, ev);
      return { id: String(json.id ?? eventId) };
    },

    async findEventIdByPrivateProp(token, calendarId, key, value) {
      const params = new URLSearchParams();
      params.set("privateExtendedProperty", `${key}=${value}`); // → key%3Dvalue (Google's filter form)
      params.set("maxResults", "1");
      params.set("showDeleted", "false");
      const json = await request("GET", `${eventsUrl(calendarId)}?${params.toString()}`, token);
      const items = (json.items ?? []) as Array<{ id?: string }>;
      return items[0]?.id ? String(items[0].id) : null;
    },

    async deleteEvent(token, calendarId, eventId) {
      await deleteRequest(`${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, token);
    },
  };
}
