import { describe, expect, it, vi } from "vitest";
import type { SavedEvent } from "../../src/db/event-store/index.ts";
import { type CalendarToolDeps, pushSavedEventsToCalendar } from "../../src/tools/index.ts";

// A minimal connected-calendar deps stub: a valid unexpired token → getValidAccessToken returns ok → writes.
function mockDeps(insertEvent: ReturnType<typeof vi.fn>): CalendarToolDeps {
  return {
    client: {
      list: vi.fn(),
      findEventIdByPrivateProp: vi.fn(async () => null),
      insertEvent,
      patchEvent: vi.fn(async () => ({ id: "p" })),
    },
    oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
    credentials: {
      get: vi.fn(() => ({
        accessToken: "a",
        refreshToken: "r",
        expiry: "2099-01-01 00:00:00",
        scopes: [],
      })),
      updateTokens: vi.fn(),
      delete: vi.fn(),
    },
    calendarId: "primary",
    windowDays: 30,
    maxEvents: 20,
  } as unknown as CalendarToolDeps;
}

const saved = (over: Partial<SavedEvent>): SavedEvent => ({
  id: 1,
  kind: "reminder",
  title_he: "לשתות מים",
  date_iso: "2026-07-01",
  time: null,
  location: null,
  assignee: null,
  recurrence: null,
  standing: null,
  source_text: "לשתות מים",
  source_provider: null,
  status: "open",
  ...over,
});

describe("pushSavedEventsToCalendar — #224 standing reminders are digest-only", () => {
  it("does NOT push a standing daily reminder to Google Calendar", async () => {
    const insertEvent = vi.fn(async () => ({ id: "gcal" }));
    const { pushed } = await pushSavedEventsToCalendar(
      [saved({ standing: { cadence: "daily" } })],
      mockDeps(insertEvent),
      "default",
    );
    expect(insertEvent).not.toHaveBeenCalled();
    expect(pushed).toBe(0);
  });

  it("still pushes a normal (non-standing) board event", async () => {
    const insertEvent = vi.fn(async () => ({ id: "gcal" }));
    const { pushed } = await pushSavedEventsToCalendar(
      [saved({ kind: "event", standing: null })],
      mockDeps(insertEvent),
      "default",
    );
    expect(insertEvent).toHaveBeenCalledTimes(1);
    expect(pushed).toBe(1);
  });
});
