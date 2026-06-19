import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  jerusalemHhmm,
  jerusalemHour,
  jerusalemTodayIso,
  startOfWeekSundayIso,
  weekdayIndex,
} from "./date";

describe("date helpers (Asia/Jerusalem, week starts Sunday)", () => {
  it("formats Jerusalem 'today' as YYYY-MM-DD", () => {
    expect(jerusalemTodayIso(new Date("2026-06-19T20:00:00Z"))).toBe("2026-06-19");
  });

  it("rolls past Jerusalem midnight (UTC+3 in June)", () => {
    // 22:30Z = 01:30 next day in Asia/Jerusalem
    expect(jerusalemTodayIso(new Date("2026-06-19T22:30:00Z"))).toBe("2026-06-20");
  });

  it("weekdayIndex: Sunday is 0", () => {
    expect(weekdayIndex("2026-06-21")).toBe(0); // 2026-06-21 is a Sunday
    expect(weekdayIndex("2026-06-24")).toBe(3); // Wednesday
  });

  it("startOfWeekSundayIso snaps back to the Sunday", () => {
    expect(startOfWeekSundayIso("2026-06-24")).toBe("2026-06-21");
    expect(startOfWeekSundayIso("2026-06-21")).toBe("2026-06-21");
  });

  it("jerusalemHhmm formats HH:MM in Jerusalem (UTC+3 in June)", () => {
    expect(jerusalemHhmm(new Date("2026-06-20T12:00:00Z"))).toBe("15:00");
    expect(jerusalemHhmm(new Date("2026-06-20T21:05:00Z"))).toBe("00:05"); // rolls past midnight
  });

  it("jerusalemHour returns the 24h hour in Jerusalem", () => {
    expect(jerusalemHour(new Date("2026-06-20T12:00:00Z"))).toBe(15);
    expect(jerusalemHour(new Date("2026-06-20T21:05:00Z"))).toBe(0);
  });

  it("addDaysIso advances the calendar date, crossing month/year", () => {
    expect(addDaysIso("2026-06-20", 1)).toBe("2026-06-21");
    expect(addDaysIso("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
