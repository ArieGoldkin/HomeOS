import { describe, expect, it } from "vitest";
import { computeDogfoodMetrics } from "../../src/core/dogfood-metrics.ts";

const NOW = new Date("2026-07-01T00:00:00Z");

function inbound(outcomes: Record<string, number>, byDay: Array<{ day: string; count: number }>) {
  return { outcomeCountsSince: () => outcomes, forwardsByDaySince: () => byDay };
}
const metrics = (days: number) => ({ boardReadDaysSince: () => days });

// 30 days each with 1 forward → perDay = 1 (clears the ≥1/day gate).
const oneForwardPerDay = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-06-${String(i + 1).padStart(2, "0")}`,
  count: 1,
}));

describe("computeDogfoodMetrics (#26)", () => {
  it("verdict 'go' when all three gates pass", () => {
    const m = computeDogfoodMetrics(
      inbound({ parsed: 18, rephrase: 2, clarified: 1 }, oneForwardPerDay), // accuracy 0.9
      metrics(25), // 25/30 ≈ 0.83 glance rate
      { windowDays: 30, now: NOW },
    );
    expect(m.verdict).toBe("go");
    expect(m.gates.forwardHabit.pass).toBe(true);
    expect(m.gates.parseAccuracy.pass).toBe(true);
    expect(m.gates.dailyGlance.pass).toBe(true);
    expect(m.parse.accuracy).toBeCloseTo(0.9);
    expect(m.forwards.perDay).toBe(1);
    expect(m.engagement.daysWithGlance).toBe(25);
  });

  it("verdict 'no-go' when parse accuracy is below threshold", () => {
    const m = computeDogfoodMetrics(
      inbound({ parsed: 5, rephrase: 5 }, oneForwardPerDay), // accuracy 0.5
      metrics(30),
      { windowDays: 30, now: NOW },
    );
    expect(m.parse.accuracy).toBeCloseTo(0.5);
    expect(m.gates.parseAccuracy.pass).toBe(false);
    expect(m.verdict).toBe("no-go");
  });

  it("a gate with no data (null accuracy) never passes", () => {
    const m = computeDogfoodMetrics(inbound({}, oneForwardPerDay), metrics(30), {
      windowDays: 30,
      now: NOW,
    });
    expect(m.parse.accuracy).toBeNull();
    expect(m.gates.parseAccuracy.pass).toBe(false);
    expect(m.verdict).toBe("no-go");
  });

  it("fails the forward-habit gate when volume is under ≥1/day", () => {
    const m = computeDogfoodMetrics(
      inbound({ parsed: 10 }, [{ day: "2026-06-15", count: 5 }]), // 5 forwards over 30 days → 0.17/day
      metrics(30),
      { windowDays: 30, now: NOW },
    );
    expect(m.forwards.total).toBe(5);
    expect(m.gates.forwardHabit.pass).toBe(false);
    expect(m.verdict).toBe("no-go");
  });

  it("honors overridden thresholds", () => {
    const m = computeDogfoodMetrics(
      inbound({ parsed: 6, rephrase: 4 }, oneForwardPerDay),
      metrics(30),
      {
        windowDays: 30,
        now: NOW,
        thresholds: { parseAccuracy: 0.5 }, // 0.6 now clears a 0.5 bar
      },
    );
    expect(m.gates.parseAccuracy.pass).toBe(true);
  });
});
