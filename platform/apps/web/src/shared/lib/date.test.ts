import { describe, expect, it } from "vitest";
import { jerusalemTodayIso, startOfWeekSundayIso, weekdayIndex } from "./date";

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
});
