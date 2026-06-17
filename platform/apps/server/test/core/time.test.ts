import { describe, expect, it } from "vitest";
import { jerusalemDayStartSqlite, sqliteUtc } from "../../src/core/time.ts";

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
