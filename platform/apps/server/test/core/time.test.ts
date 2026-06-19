import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  jerusalemDayStartIso,
  jerusalemDayStartSqlite,
  jerusalemWallClock,
  sqliteUtc,
} from "../../src/core/time.ts";

describe("sqliteUtc", () => {
  it("formats a Date as a SQLite UTC datetime string (drops ms, space-separated)", () => {
    expect(sqliteUtc(new Date("2026-06-17T05:30:45.123Z"))).toBe("2026-06-17 05:30:45");
  });
});

describe("jerusalemDayStartSqlite", () => {
  it("returns Jerusalem midnight as a UTC cutoff in summer (IDT, UTC+3)", () => {
    // 2026-06-17 08:00 UTC = 11:00 Jerusalem (IDT). Day start = 2026-06-17 00:00 IDT = 2026-06-16 21:00 UTC.
    expect(jerusalemDayStartSqlite(new Date("2026-06-17T08:00:00Z"))).toBe("2026-06-16 21:00:00");
  });

  it("keys off the Jerusalem calendar day, not UTC (just-after-local-midnight)", () => {
    // 2026-06-16 21:30 UTC = 2026-06-17 00:30 Jerusalem (IDT) — already the 17th locally.
    expect(jerusalemDayStartSqlite(new Date("2026-06-16T21:30:00Z"))).toBe("2026-06-16 21:00:00");
  });

  it("handles standard time in winter (IST, UTC+2)", () => {
    // 2026-01-15 08:00 UTC = 10:00 Jerusalem (IST). Day start = 2026-01-15 00:00 IST = 2026-01-14 22:00 UTC.
    expect(jerusalemDayStartSqlite(new Date("2026-01-15T08:00:00Z"))).toBe("2026-01-14 22:00:00");
  });
});

describe("jerusalemDayStartIso / addDaysIso (Calendar API timeMin/timeMax, #18)", () => {
  it("renders Jerusalem midnight as an RFC3339 Z instant (summer IDT)", () => {
    expect(jerusalemDayStartIso(new Date("2026-06-17T08:00:00Z"))).toBe("2026-06-16T21:00:00.000Z");
  });
  it("adds whole days to the instant for the timeMax clamp", () => {
    expect(addDaysIso(new Date("2026-06-17T08:00:00Z"), 30)).toBe("2026-07-17T08:00:00.000Z");
  });
});

describe("jerusalemWallClock (timed calendar event → board date/time, no UTC drift, #18 AC3)", () => {
  it("reads the Jerusalem wall-clock from an explicit +03:00 offset", () => {
    expect(jerusalemWallClock(new Date("2026-06-20T18:30:00+03:00"))).toEqual({
      dateIso: "2026-06-20",
      time: "18:30",
    });
  });
  it("keeps the late-evening event on its Jerusalem day (a naive UTC read would roll to the next day)", () => {
    // 23:30+03:00 on the 20th = 20:30Z on the 20th — still the 20th locally.
    expect(jerusalemWallClock(new Date("2026-06-20T23:30:00+03:00"))).toEqual({
      dateIso: "2026-06-20",
      time: "23:30",
    });
  });
  it("converts a Z-suffixed instant into the Jerusalem day + time (summer +3)", () => {
    // 2026-06-20 22:00Z = 2026-06-21 01:00 Jerusalem (IDT) — rolls forward, correctly.
    expect(jerusalemWallClock(new Date("2026-06-20T22:00:00Z"))).toEqual({
      dateIso: "2026-06-21",
      time: "01:00",
    });
  });
  it("applies winter standard time (IST, +2)", () => {
    // 2026-01-15 22:30Z = 2026-01-16 00:30 Jerusalem (IST) — next day, 00:30 (not "24:30").
    expect(jerusalemWallClock(new Date("2026-01-15T22:30:00Z"))).toEqual({
      dateIso: "2026-01-16",
      time: "00:30",
    });
  });
});
