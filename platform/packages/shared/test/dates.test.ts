import { describe, expect, it } from "vitest";
import { jerusalemTodayIso } from "../src/index.ts";

// #284 — moved from the web's shared/lib/date.ts so server and web share ONE day-boundary truth.
// The traps these pin are the repo's known bug class: UTC-vs-Jerusalem day drift around midnight.

describe("jerusalemTodayIso (#284)", () => {
  it("shifts a late-UTC instant into the NEXT Jerusalem day (summer, UTC+3)", () => {
    // 21:30Z on Jul 2 = 00:30 Jul 3 in Asia/Jerusalem (IDT).
    expect(jerusalemTodayIso(new Date("2026-07-02T21:30:00Z"))).toBe("2026-07-03");
  });

  it("keeps an early-UTC instant on the SAME Jerusalem day", () => {
    expect(jerusalemTodayIso(new Date("2026-07-02T10:00:00Z"))).toBe("2026-07-02");
  });

  it("handles the winter offset (UTC+2) boundary", () => {
    // 22:30Z on Jan 5 = 00:30 Jan 6 in Asia/Jerusalem (IST).
    expect(jerusalemTodayIso(new Date("2026-01-05T22:30:00Z"))).toBe("2026-01-06");
    // 21:30Z on Jan 5 = 23:30 Jan 5 — still the same day in winter.
    expect(jerusalemTodayIso(new Date("2026-01-05T21:30:00Z"))).toBe("2026-01-05");
  });
});
