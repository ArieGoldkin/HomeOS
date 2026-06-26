import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { TransientError } from "../../src/core/errors.ts";
import type { EventMeta, EventStore, SavedEvent } from "../../src/db/event-store/index.ts";
import type { CalendarEvent, CalendarWriteEvent } from "../../src/google/calendar.ts";
import {
  buildGmailQuery,
  type CalendarToolDeps,
  deleteFromCalendar,
  extractEventsTool,
  type GmailToolDeps,
  mapCalendarEvent,
  mapToCalendarWrite,
  pushSavedEventsToCalendar,
  readCalendarTool,
  readGmailTool,
  searchEventsTool,
  type ToolContext,
} from "../../src/tools/index.ts";

const sampleEvent: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-21",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
  source_text: "אסיפת הורים מחר ב-18:30",
};

// A fake EventStore that records saveEvent + returns a SavedEvent (the row the tool now persists, #71).
function makeStore() {
  let id = 0;
  const saveEvent = vi.fn(
    (e: ParsedEvent, m: EventMeta): SavedEvent => ({
      id: ++id,
      source_provider: m.sourceProvider ?? null,
      ...e,
    }),
  );
  const searchEvents = vi.fn((): SavedEvent[] => []);
  const store = {
    saveEvent,
    listEvents: vi.fn(() => []),
    deleteLastFromSender: vi.fn(() => 0),
    countSince: vi.fn(() => 0),
    deleteByProvider: vi.fn(() => 0),
    deleteById: vi.fn(() => 1),
    findEventsByRef: vi.fn(() => []),
    searchEvents,
    updateEvent: vi.fn(() => null),
  } as unknown as EventStore;
  return { store, saveEvent, searchEvents };
}

function makeCtx(over: Partial<ToolContext> = {}) {
  const { store, saveEvent, searchEvents } = makeStore();
  const ctx: ToolContext = {
    todayIso: "2026-06-20",
    from: "972501234567",
    waMessageId: "wamid.1",
    familyId: "default",
    events: store,
    ...over,
  };
  return { ctx, saveEvent, searchEvents };
}

// #84: tool.run now returns a {saved}|{clarify} union. read_gmail/read_calendar (and the happy
// extract_events path) always save — narrow for the assertions; a {clarify} here is a test failure.
function savedRows(
  out: { saved: SavedEvent[] } | { clarify: unknown } | { resolved: unknown },
): SavedEvent[] {
  if (!("saved" in out)) throw new Error("expected a {saved} result, got a non-saved arm");
  return out.saved;
}

describe("extractEventsTool", () => {
  it("has the declarative tool shape (name, description, zod inputSchema)", () => {
    const tool = extractEventsTool(vi.fn());
    expect(tool.name).toBe("extract_events");
    expect(typeof tool.description).toBe("string");
    expect(tool.inputSchema.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("delegates to the injected ParseMessage with ctx.todayIso, then persists what it saved", async () => {
    const parse = vi.fn(async () => [sampleEvent]);
    const { ctx, saveEvent } = makeCtx();
    const out = await extractEventsTool(parse).run({ text: "אסיפת הורים מחר" }, ctx);

    expect(parse).toHaveBeenCalledWith("אסיפת הורים מחר", "2026-06-20", undefined);
    // #71: the TOOL persists under the inbound's own key — fromPhone/waMessageId from ctx (G8), seq 0.
    expect(saveEvent).toHaveBeenCalledWith(sampleEvent, {
      fromPhone: "972501234567",
      waMessageId: "wamid.1",
      seq: 0,
    });
    expect(savedRows(out)).toEqual([{ id: 1, source_provider: null, ...sampleEvent }]);
  });

  it("passes the server-supplied senderName to parse (first-person → assignee, G8/#14)", async () => {
    const parse = vi.fn(async () => [sampleEvent]);
    const { ctx } = makeCtx({ senderName: "אבא" });
    await extractEventsTool(parse).run({ text: "יש לי פיזיותרפיה" }, ctx);
    expect(parse).toHaveBeenCalledWith("יש לי פיזיותרפיה", "2026-06-20", "אבא");
  });

  it("maps a null parse (unparseable) to an empty saved list — nothing persisted", async () => {
    const { ctx, saveEvent } = makeCtx();
    const out = await extractEventsTool(vi.fn(async () => null)).run({ text: "???" }, ctx);
    expect(savedRows(out)).toEqual([]);
    expect(saveEvent).not.toHaveBeenCalled();
  });

  it("persists every event of a multi-event parse under its own seq, tagged as a forward (source_provider null)", async () => {
    const second: ParsedEvent = { ...sampleEvent, title_he: "טיול שנתי", time: null };
    const parse = vi.fn(async () => [sampleEvent, second]);
    const { ctx, saveEvent } = makeCtx();
    const out = await extractEventsTool(parse).run({ text: "two" }, ctx);

    expect(saveEvent).toHaveBeenCalledTimes(2);
    expect(saveEvent.mock.calls[0]![1]).toEqual({
      fromPhone: "972501234567",
      waMessageId: "wamid.1",
      seq: 0,
    });
    expect(saveEvent.mock.calls[1]![1]).toEqual({
      fromPhone: "972501234567",
      waMessageId: "wamid.1",
      seq: 1,
    });
    expect(savedRows(out)).toHaveLength(2);
    expect(savedRows(out).map((e) => e.source_provider)).toEqual([null, null]); // forwards, not provider rows
  });

  it("#84: surfaces a {clarify} arm and saves NOTHING when the model flags a required slot", async () => {
    const flagged: ParsedEvent = {
      ...sampleEvent,
      needs_clarification: { reason: "missing_date" },
    };
    const parse = vi.fn(async () => [flagged]);
    const { ctx, saveEvent } = makeCtx();

    const out = await extractEventsTool(parse).run({ text: "פגישה עם הגננת" }, ctx);

    expect("clarify" in out).toBe(true);
    if ("clarify" in out) {
      expect(out.clarify.reason).toBe("missing_date");
      expect(out.clarify.draft.title_he).toBe(sampleEvent.title_he);
    }
    expect(saveEvent).not.toHaveBeenCalled(); // the conservative gate saves nothing on a clarify
  });

  it("#84: an OPTIONAL-slot flag (missing_time) does NOT clarify — still auto-adds (conservative gate)", async () => {
    const flagged: ParsedEvent = {
      ...sampleEvent,
      needs_clarification: { reason: "missing_time" },
    };
    const { ctx, saveEvent } = makeCtx();

    const out = await extractEventsTool(vi.fn(async () => [flagged])).run({ text: "x" }, ctx);

    expect(savedRows(out)).toHaveLength(1); // time is optional → saved, never asked
    expect(saveEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects missing / empty / oversized text via inputSchema (a structured error, not a throw)", () => {
    const tool = extractEventsTool(vi.fn());
    expect(tool.inputSchema.safeParse({}).success).toBe(false);
    expect(tool.inputSchema.safeParse({ text: "" }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ text: "a".repeat(8001) }).success).toBe(false);
  });

  it("converts inputSchema to a valid object-root JSON Schema (z.toJSONSchema)", () => {
    const tool = extractEventsTool(vi.fn());
    const json = z.toJSONSchema(tool.inputSchema) as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(json.type).toBe("object");
    expect(json.properties).toHaveProperty("text");
  });
});

// A fake Gmail seam: a connected credential (non-expired), a mock read client, mock oauth client.
function makeGoogle(over: Record<string, unknown> = {}): GmailToolDeps {
  return {
    client: {
      list: vi.fn(async () => []),
      get: vi.fn(async (_t: string, id: string) => ({
        id,
        subject: `subj ${id}`,
        bodyText: `body ${id}`,
      })),
    },
    oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
    credentials: {
      get: vi.fn(() => ({
        accessToken: "acc",
        refreshToken: "ref",
        expiry: "2099-01-01 00:00:00",
        scopes: [],
      })),
      updateTokens: vi.fn(),
      delete: vi.fn(),
    },
    maxMessages: 10,
    queryWindow: "newer_than:7d",
    allowedLabels: ["family"],
    ...over,
  } as unknown as GmailToolDeps;
}

// #147 — the read-only resolve tool: delegates to events.searchEvents, merges the SERVER date/time from
// ctx.resolveRef (never model-supplied), and returns the {resolved} arm. Read-only — never saves.
describe("searchEventsTool (#147)", () => {
  it("has the resolve tool shape (name, description, titleHint schema)", () => {
    const tool = searchEventsTool();
    expect(tool.name).toBe("search_events");
    expect(tool.inputSchema.safeParse({ titleHint: "פגישה" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({}).success).toBe(false); // titleHint required
  });

  it("searches events with the model titleHint + server resolveRef, returns {resolved}", async () => {
    const cand: SavedEvent = { id: 9, source_provider: null, ...sampleEvent };
    const { ctx, searchEvents, saveEvent } = makeCtx({ resolveRef: { dateIso: "2026-06-22" } });
    searchEvents.mockReturnValue([cand]);

    const out = await searchEventsTool().run({ titleHint: "פגישה יונתן" }, ctx);

    expect(searchEvents).toHaveBeenCalledWith("default", {
      titleHint: "פגישה יונתן",
      dateIso: "2026-06-22", // merged from ctx.resolveRef, NOT from the model
    });
    expect("resolved" in out && out.resolved).toEqual([cand]);
    expect(saveEvent).not.toHaveBeenCalled(); // read-only
  });

  it("omits date/time when no resolveRef is set (pure title-term search)", async () => {
    const { ctx, searchEvents } = makeCtx();
    await searchEventsTool().run({ titleHint: "כדורגל" }, ctx);
    expect(searchEvents).toHaveBeenCalledWith("default", { titleHint: "כדורגל" });
  });
});

describe("buildGmailQuery (server-clamped, G8)", () => {
  it("always applies the recency window", () => {
    expect(buildGmailQuery({}, { queryWindow: "newer_than:7d" })).toBe("newer_than:7d");
  });
  it("honours an allowlisted label and drops a non-allowlisted one", () => {
    const deps = { queryWindow: "newer_than:7d", allowedLabels: ["family"] };
    expect(buildGmailQuery({ label: "family" }, deps)).toBe("newer_than:7d label:family");
    expect(buildGmailQuery({ label: "evil" }, deps)).toBe("newer_than:7d");
  });
  it("sanitises fromSender so the model can't inject Gmail operators", () => {
    expect(
      buildGmailQuery({ fromSender: "a@b.com OR is:starred" }, { queryWindow: "newer_than:7d" }),
    ).toBe("newer_than:7d from:a@b.comORisstarred");
  });
});

describe("readGmailTool (#72)", () => {
  it("is opt-in: no ctx.google → { saved: [] }, zero parse calls", async () => {
    const parse = vi.fn();
    const { ctx } = makeCtx();
    expect(savedRows(await readGmailTool(parse).run({}, ctx))).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it("not connected (no credential) → { saved: [] }, ZERO Gmail and parse calls", async () => {
    const google = makeGoogle({
      credentials: { get: vi.fn(() => null), updateTokens: vi.fn(), delete: vi.fn() },
    });
    const parse = vi.fn();
    const { ctx } = makeCtx({ google });
    expect(savedRows(await readGmailTool(parse).run({}, ctx))).toEqual([]);
    expect(google.client.list).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("connected: lists → fetches → parses subject+body → persists under gmail:<id> tagged google", async () => {
    const google = makeGoogle({
      client: {
        list: vi.fn(async () => [
          { id: "m1", threadId: "t1" },
          { id: "m2", threadId: "t2" },
        ]),
        get: vi.fn(async (_t: string, id: string) => ({
          id,
          subject: `subj ${id}`,
          bodyText: `body ${id}`,
        })),
      },
    });
    const parse = vi.fn(async () => [sampleEvent]);
    const { ctx, saveEvent } = makeCtx({ google });
    const out = await readGmailTool(parse).run({}, ctx);

    expect(google.client.list).toHaveBeenCalledWith("acc", "newer_than:7d", 10);
    expect(parse).toHaveBeenCalledWith("subj m1\nbody m1", "2026-06-20", undefined);
    expect(saveEvent).toHaveBeenCalledWith(sampleEvent, {
      fromPhone: "972501234567",
      waMessageId: "gmail:m1",
      seq: 0,
      sourceProvider: "google",
    });
    expect(savedRows(out)).toHaveLength(2);
    expect(savedRows(out).every((e) => e.source_provider === "google")).toBe(true);
  });

  it("clamps the model's query hints (label allowlisted + fromSender sanitised)", async () => {
    const google = makeGoogle({
      allowedLabels: ["gan"],
      client: { list: vi.fn(async () => []), get: vi.fn() },
    });
    const { ctx } = makeCtx({ google });
    await readGmailTool(vi.fn()).run({ label: "gan", fromSender: "teacher@gan.il; DROP" }, ctx);
    expect(google.client.list).toHaveBeenCalledWith(
      "acc",
      "newer_than:7d label:gan from:teacher@gan.ilDROP",
      10,
    );
  });

  it("propagates a Gmail TransientError out of run (→ inbound row stays pending)", async () => {
    const google = makeGoogle({
      client: {
        list: vi.fn(async () => {
          throw new TransientError("gmail 429");
        }),
        get: vi.fn(),
      },
    });
    const { ctx } = makeCtx({ google });
    await expect(readGmailTool(vi.fn()).run({}, ctx)).rejects.toBeInstanceOf(TransientError);
  });
});

const calTimed: CalendarEvent = {
  id: "e1",
  summary: "פגישת הורים",
  location: "גן רימון",
  description: "אסיפה שנתית",
  start: { dateTime: "2026-06-21T18:30:00+03:00" },
};
const calAllDay: CalendarEvent = { id: "e2", summary: "טיול שנתי", start: { date: "2026-06-22" } };

describe("mapCalendarEvent (Google event → board ParsedEvent, #18)", () => {
  it("maps a timed event to the Jerusalem date+time (no UTC drift, AC3)", () => {
    expect(mapCalendarEvent(calTimed)).toEqual({
      kind: "event",
      title_he: "פגישת הורים",
      date_iso: "2026-06-21",
      time: "18:30",
      location: "גן רימון",
      assignee: null,
      recurrence: null,
      source_text: "פגישת הורים · גן רימון · אסיפה שנתית",
    });
  });

  it("maps an all-day event to a dated, time-less board event", () => {
    expect(mapCalendarEvent(calAllDay)).toMatchObject({
      title_he: "טיול שנתי",
      date_iso: "2026-06-22",
      time: null,
      location: null,
    });
  });

  it("keeps a late-evening timed event on its Jerusalem day", () => {
    expect(
      mapCalendarEvent({ ...calTimed, start: { dateTime: "2026-06-21T23:30:00+03:00" } }),
    ).toMatchObject({
      date_iso: "2026-06-21",
      time: "23:30",
    });
  });

  it("skips a cancelled instance, an untitled block, and an event with no start", () => {
    expect(mapCalendarEvent({ ...calAllDay, status: "cancelled" })).toBeNull();
    expect(mapCalendarEvent({ id: "x", summary: "   ", start: { date: "2026-06-22" } })).toBeNull();
    expect(mapCalendarEvent({ id: "x", summary: "כותרת", start: {} })).toBeNull();
  });

  it("sanitizes a summary with a bidi/RTL-override codepoint instead of dropping the event (G15)", () => {
    const mapped = mapCalendarEvent({ ...calAllDay, summary: "אסיפה‮גזל" });
    expect(mapped?.title_he).toBe("אסיפהגזל");
  });

  it("bounds an over-length summary to the schema's 80-char title", () => {
    const mapped = mapCalendarEvent({ ...calAllDay, summary: "א".repeat(200) });
    expect(mapped?.title_he).toBe("א".repeat(80));
  });

  it("returns null when the dateTime is unparseable (backstop, never stored malformed)", () => {
    expect(mapCalendarEvent({ ...calTimed, start: { dateTime: "not-a-date" } })).toBeNull();
  });
});

// A fake Calendar seam: a connected credential (non-expired), a mock read client, a fixed clock.
function makeCalendar(over: Record<string, unknown> = {}): CalendarToolDeps {
  return {
    client: {
      list: vi.fn(async () => []),
      findEventIdByPrivateProp: vi.fn(async () => null),
      insertEvent: vi.fn(async () => ({ id: "gcal-new" })),
      patchEvent: vi.fn(async () => ({ id: "gcal-patched" })),
      deleteEvent: vi.fn(async () => {}),
    },
    oauthClient: { exchangeCode: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
    credentials: {
      get: vi.fn(() => ({
        accessToken: "acc",
        refreshToken: "ref",
        expiry: "2099-01-01 00:00:00",
        scopes: [],
      })),
      updateTokens: vi.fn(),
      delete: vi.fn(),
    },
    calendarId: "primary",
    windowDays: 30,
    maxEvents: 20,
    now: () => new Date("2026-06-20T08:00:00Z"),
    ...over,
  } as unknown as CalendarToolDeps;
}

describe("readCalendarTool (#18)", () => {
  it("is opt-in: no ctx.calendar → { saved: [] }", async () => {
    const { ctx } = makeCtx();
    expect(savedRows(await readCalendarTool().run({}, ctx))).toEqual([]);
  });

  it("not connected (no credential) → { saved: [] }, ZERO calendar calls", async () => {
    const calendar = makeCalendar({
      credentials: { get: vi.fn(() => null), updateTokens: vi.fn(), delete: vi.fn() },
    });
    const { ctx } = makeCtx({ calendar });
    expect(savedRows(await readCalendarTool().run({}, ctx))).toEqual([]);
    expect(calendar.client.list).not.toHaveBeenCalled();
  });

  it("connected: lists with server-owned clamps (calendarId/timeMin/timeMax/maxResults)", async () => {
    const calendar = makeCalendar();
    const { ctx } = makeCtx({ calendar });
    await readCalendarTool().run({}, ctx);
    // now = 2026-06-20 08:00Z (IDT +3) → Jerusalem day-start 2026-06-19 21:00Z; +30d window.
    expect(calendar.client.list).toHaveBeenCalledWith("acc", {
      calendarId: "primary",
      timeMin: "2026-06-19T21:00:00.000Z",
      timeMax: "2026-07-20T08:00:00.000Z",
      maxResults: 20,
    });
  });

  it("persists each mapped event under gcal:<id>, seq 0, tagged source_provider google", async () => {
    const calendar = makeCalendar({ client: { list: vi.fn(async () => [calTimed, calAllDay]) } });
    const { ctx, saveEvent } = makeCtx({ calendar });
    const out = await readCalendarTool().run({}, ctx);

    expect(saveEvent.mock.calls[0]![1]).toEqual({
      fromPhone: "972501234567",
      waMessageId: "gcal:e1",
      seq: 0,
      sourceProvider: "google",
    });
    expect(saveEvent.mock.calls[1]![1]!.waMessageId).toBe("gcal:e2");
    expect(savedRows(out)).toHaveLength(2);
    expect(savedRows(out).every((e) => e.source_provider === "google")).toBe(true);
  });

  it("skips unmappable events but keeps the rest", async () => {
    const untitled: CalendarEvent = { id: "e3", summary: "   ", start: { date: "2026-06-23" } };
    const calendar = makeCalendar({ client: { list: vi.fn(async () => [calTimed, untitled]) } });
    const { ctx, saveEvent } = makeCtx({ calendar });
    const out = await readCalendarTool().run({}, ctx);
    expect(savedRows(out)).toHaveLength(1);
    expect(saveEvent).toHaveBeenCalledTimes(1);
  });

  it("propagates a Calendar TransientError out of run (→ inbound row stays pending)", async () => {
    const calendar = makeCalendar({
      client: {
        list: vi.fn(async () => {
          throw new TransientError("calendar 429");
        }),
      },
    });
    const { ctx } = makeCtx({ calendar });
    await expect(readCalendarTool().run({}, ctx)).rejects.toBeInstanceOf(TransientError);
  });
});

const boardSaved: SavedEvent = { id: 7, source_provider: null, ...sampleEvent };
const googleSaved: SavedEvent = { id: 8, source_provider: "google", ...sampleEvent };

describe("mapToCalendarWrite (board ParsedEvent → Google write body, #18 chunk 2)", () => {
  it("maps a timed event to dateTime+timeZone start/end (+1h) with the homeosEventId", () => {
    expect(mapToCalendarWrite(sampleEvent, "7")).toEqual({
      summary: "אסיפת הורים",
      start: { dateTime: "2026-06-21T18:30:00", timeZone: "Asia/Jerusalem" },
      end: { dateTime: "2026-06-21T19:30:00", timeZone: "Asia/Jerusalem" },
      location: "גן רימון",
      description: "אסיפת הורים מחר ב-18:30",
      extendedProperties: { private: { homeosEventId: "7" } },
    });
  });

  it("maps an all-day event to date start + exclusive next-day end, no timeZone", () => {
    const allDay: ParsedEvent = { ...sampleEvent, time: null, location: null };
    expect(mapToCalendarWrite(allDay, "9")).toMatchObject({
      start: { date: "2026-06-21" },
      end: { date: "2026-06-22" },
    });
    expect(mapToCalendarWrite(allDay, "9").location).toBeUndefined();
  });

  it("rolls the end past midnight for a late-evening start", () => {
    const late: ParsedEvent = { ...sampleEvent, time: "23:30" };
    expect(mapToCalendarWrite(late, "1").end).toEqual({
      dateTime: "2026-06-22T00:30:00",
      timeZone: "Asia/Jerusalem",
    });
  });

  it("maps a weekly recurrence to an RRULE with the right BYDAY", () => {
    const weekly: ParsedEvent = { ...sampleEvent, recurrence: { freq: "weekly", weekday: 2 } }; // Tue
    expect(mapToCalendarWrite(weekly, "1").recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  });
});

describe("pushSavedEventsToCalendar (#18 chunk 2 auto-push)", () => {
  it("skips when there are no board-originated rows (provider rows are never written back, AC5)", async () => {
    const calendar = makeCalendar();
    const out = await pushSavedEventsToCalendar([googleSaved], calendar, "default");
    expect(out.pushed).toBe(0);
    expect(calendar.client.findEventIdByPrivateProp).not.toHaveBeenCalled();
  });

  it("not connected → pushed 0, no insert/patch (AC6)", async () => {
    const calendar = makeCalendar({
      credentials: { get: vi.fn(() => null), updateTokens: vi.fn(), delete: vi.fn() },
    });
    const out = await pushSavedEventsToCalendar([boardSaved], calendar, "default");
    expect(out.pushed).toBe(0);
    expect(calendar.client.insertEvent).not.toHaveBeenCalled();
  });

  it("inserts a new event when the homeosEventId lookup misses (idempotency, AC4)", async () => {
    const calendar = makeCalendar();
    const out = await pushSavedEventsToCalendar([boardSaved], calendar, "default");
    expect(calendar.client.findEventIdByPrivateProp).toHaveBeenCalledWith(
      "acc",
      "primary",
      "homeosEventId",
      "7",
    );
    expect(calendar.client.insertEvent).toHaveBeenCalledWith(
      "acc",
      "primary",
      mapToCalendarWrite(boardSaved, "7"),
    );
    expect(calendar.client.patchEvent).not.toHaveBeenCalled();
    expect(out.pushed).toBe(1);
  });

  it("patches the existing event when the homeosEventId is found (board-wins, no duplicate, AC5)", async () => {
    const calendar = makeCalendar({
      client: {
        list: vi.fn(),
        findEventIdByPrivateProp: vi.fn(async () => "gcal-existing"),
        insertEvent: vi.fn(),
        patchEvent: vi.fn(async () => ({ id: "gcal-existing" })),
      },
    });
    const out = await pushSavedEventsToCalendar([boardSaved], calendar, "default");
    expect(calendar.client.patchEvent).toHaveBeenCalledWith(
      "acc",
      "primary",
      "gcal-existing",
      mapToCalendarWrite(boardSaved, "7"),
    );
    expect(calendar.client.insertEvent).not.toHaveBeenCalled();
    expect(out.pushed).toBe(1);
  });

  it("is best-effort: a push error is logged, the rest continue, and it NEVER throws", async () => {
    const second: SavedEvent = { ...boardSaved, id: 9, title_he: "טיול" };
    const calendar = makeCalendar({
      client: {
        list: vi.fn(),
        findEventIdByPrivateProp: vi.fn(async () => null),
        insertEvent: vi.fn(async (_t: string, _c: string, body: CalendarWriteEvent) => {
          if (body.summary === "אסיפת הורים") throw new TransientError("calendar 429");
          return { id: "ok" };
        }),
        patchEvent: vi.fn(),
      },
    });
    const out = await pushSavedEventsToCalendar([boardSaved, second], calendar, "default");
    expect(out.pushed).toBe(1); // the second event still pushed; the first failed without throwing
  });
});

describe("deleteFromCalendar (#85 best-effort, idempotent Google delete)", () => {
  it("resolves the Google id by homeosEventId and deletes it", async () => {
    const calendar = makeCalendar({
      client: {
        list: vi.fn(),
        findEventIdByPrivateProp: vi.fn(async () => "gcal-7"),
        insertEvent: vi.fn(),
        patchEvent: vi.fn(),
        deleteEvent: vi.fn(async () => {}),
      },
    });
    await deleteFromCalendar(7, calendar, "default");
    expect(calendar.client.findEventIdByPrivateProp).toHaveBeenCalledWith(
      "acc",
      "primary",
      "homeosEventId",
      "7",
    );
    expect(calendar.client.deleteEvent).toHaveBeenCalledWith("acc", "primary", "gcal-7");
  });

  it("does nothing when no Google event matches (id null)", async () => {
    const calendar = makeCalendar(); // findEventIdByPrivateProp → null
    await deleteFromCalendar(7, calendar, "default");
    expect(calendar.client.deleteEvent).not.toHaveBeenCalled();
  });

  it("never throws when the Google delete fails (best-effort)", async () => {
    const calendar = makeCalendar({
      client: {
        list: vi.fn(),
        findEventIdByPrivateProp: vi.fn(async () => "gcal-7"),
        insertEvent: vi.fn(),
        patchEvent: vi.fn(),
        deleteEvent: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    });
    await expect(deleteFromCalendar(7, calendar, "default")).resolves.toBeUndefined();
  });

  it("skips entirely when not connected (no stored credential)", async () => {
    const calendar = makeCalendar({
      credentials: { get: vi.fn(() => null), updateTokens: vi.fn(), delete: vi.fn() },
    });
    await deleteFromCalendar(7, calendar, "default");
    expect(calendar.client.findEventIdByPrivateProp).not.toHaveBeenCalled();
  });
});
