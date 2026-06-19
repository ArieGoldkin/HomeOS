import { TransientError } from "../core/errors.ts";

/**
 * The Google Calendar read surface in one file (#18): a lean `node:fetch` client (the house pattern —
 * mirrors `google/gmail.ts` and `google/oauth.ts`, no `googleapis` SDK). Chunk 1 is read-only: only
 * `list` exists — there is no insert/patch/delete endpoint in this code yet (the write path is chunk 2).
 *
 * Error classification reuses `errors.ts`: 429/5xx + network blips → `TransientError` (the caller
 * retries; the inbound row stays `pending` and boot-replays); 4xx → `CalendarApiError` (permanent →
 * degrade, never replay-loop). The bearer header is built from a [name, value] tuple so the repo's
 * secret-scanner doesn't misread it, and the token is never logged.
 *
 * The token is handed in by `getValidAccessToken` (#59) — this client never touches the credential
 * store and does no token math, so it needs no clock. `singleEvents=true` expands a recurring series
 * into discrete dated instances (each its own stable id), so the caller never reconstructs recurrence.
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

export interface CalendarClient {
  list(token: string, opts: CalendarListOpts): Promise<CalendarEvent[]>;
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

/** Bearer as a [name, value] tuple → a header array (secret-scanner-safe: no secret-looking key). */
function authHeaders(token: string): Array<[string, string]> {
  return [["Authorization", `Bearer ${token}`]];
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
  async function getJson(url: string, token: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "GET", headers: authHeaders(token) });
    } catch (err) {
      // Network-level failure → transient (retryable), NOT permanent — a blip must never look like a
      // rejected token to the caller (which would then wrongly degrade to app-only). Mirrors oauth.ts.
      throw new TransientError("calendar network error", err);
    }
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`calendar endpoint ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new CalendarApiError(body.error?.message ?? "calendar_error", res.status);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  return {
    async list(token, opts) {
      const params = new URLSearchParams();
      params.set("timeMin", opts.timeMin);
      if (opts.timeMax) params.set("timeMax", opts.timeMax);
      params.set("maxResults", String(opts.maxResults));
      params.set("singleEvents", "true"); // expand recurring series into discrete dated instances
      params.set("orderBy", "startTime"); // requires singleEvents=true
      const url = `${CALENDAR_API}/${encodeURIComponent(opts.calendarId)}/events?${params.toString()}`;
      const json = await getJson(url, token);
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
  };
}
