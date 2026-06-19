import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../src/core/errors.ts";
import { CalendarApiError, httpCalendarClient } from "../../src/google/calendar.ts";

// Neutral placeholder — not a real Google access-token shape (ya29.*).
const TOKEN = "tok-123";

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const errJson = (status: number, body: unknown = {}) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

// The shape the client passes as fetch's 2nd arg — headers are [name,value] tuples (secret-scanner-safe).
type Init = { method: string; headers: Array<[string, string]> };
const authOf = (init: Init) => new Headers(init.headers).get("Authorization");

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars";

const opts = {
  calendarId: "primary",
  timeMin: "2026-06-19T21:00:00.000Z",
  timeMax: "2026-07-19T21:00:00.000Z",
  maxResults: 20,
};

describe("httpCalendarClient.list", () => {
  it("GETs the events endpoint with timeMin/timeMax/maxResults + singleEvents + orderBy + Bearer", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) =>
      Promise.resolve(
        okJson({
          items: [
            { id: "e1", summary: "פגישה", start: { dateTime: "2026-06-20T18:30:00+03:00" } },
            { id: "e2", summary: "חופש", start: { date: "2026-06-22" } },
          ],
        }),
      ),
    );
    const evs = await httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, opts);

    const [url, init] = fetchImpl.mock.calls[0]!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${CALENDAR_API}/primary/events`);
    expect(u.searchParams.get("timeMin")).toBe(opts.timeMin);
    expect(u.searchParams.get("timeMax")).toBe(opts.timeMax);
    expect(u.searchParams.get("maxResults")).toBe("20");
    expect(u.searchParams.get("singleEvents")).toBe("true");
    expect(u.searchParams.get("orderBy")).toBe("startTime");
    expect(init.method).toBe("GET");
    expect(authOf(init)).toBe("Bearer tok-123");
    expect(evs).toEqual([
      {
        id: "e1",
        summary: "פגישה",
        location: undefined,
        description: undefined,
        status: undefined,
        start: { date: undefined, dateTime: "2026-06-20T18:30:00+03:00" },
      },
      {
        id: "e2",
        summary: "חופש",
        location: undefined,
        description: undefined,
        status: undefined,
        start: { date: "2026-06-22", dateTime: undefined },
      },
    ]);
  });

  it("URL-encodes a non-primary calendar id and omits timeMax when not given", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) => Promise.resolve(okJson({ items: [] })));
    await httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, {
      calendarId: "family@group.calendar.google.com",
      timeMin: opts.timeMin,
      maxResults: 5,
    });
    const u = new URL(fetchImpl.mock.calls[0]![0]);
    expect(u.pathname).toBe(
      `/calendar/v3/calendars/${encodeURIComponent("family@group.calendar.google.com")}/events`,
    );
    expect(u.searchParams.has("timeMax")).toBe(false);
  });

  it("returns [] when there are no events (no `items` key)", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okJson({})));
    const evs = await httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, opts);
    expect(evs).toEqual([]);
  });

  it("drops cancelled instances (a declined/removed occurrence is not a board event)", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        okJson({
          items: [
            { id: "e1", summary: "live", status: "confirmed", start: { date: "2026-06-22" } },
            { id: "e2", summary: "gone", status: "cancelled", start: { date: "2026-06-23" } },
          ],
        }),
      ),
    );
    const evs = await httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, opts);
    expect(evs.map((e) => e.id)).toEqual(["e1"]);
  });

  it("classifies 429 and 5xx as transient (retryable, row stays pending)", async () => {
    for (const status of [429, 503]) {
      const fetchImpl = vi.fn(() => Promise.resolve(errJson(status)));
      await expect(
        httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, opts),
      ).rejects.toBeInstanceOf(TransientError);
    }
  });

  it("classifies a network-level throw as transient (a blip must replay, not look permanent)", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNRESET")));
    await expect(
      httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, opts),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("classifies a 4xx as a permanent CalendarApiError (token rejected → degrade, no replay)", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(errJson(401, { error: { message: "Invalid Credentials" } })),
    );
    await expect(
      httpCalendarClient(fetchImpl as unknown as typeof fetch).list(TOKEN, opts),
    ).rejects.toBeInstanceOf(CalendarApiError);
  });
});
