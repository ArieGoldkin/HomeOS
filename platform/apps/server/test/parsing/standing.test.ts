import { describe, expect, it } from "vitest";
import { detectStandingDaily } from "../../src/parsing/standing.ts";

describe("detectStandingDaily (#224 lexical gate)", () => {
  it("matches the canonical daily-cadence phrases", () => {
    for (const t of [
      "לשתות מים באופן קבוע",
      "כל יום בבוקר",
      "בכל יום",
      "מדי יום לקחת תרופה",
      "תזכיר לי להתקשר לאמא כל יום",
    ]) {
      expect(detectStandingDaily(t)).toBe(true);
    }
  });

  it("does NOT match the look-alike traps (every-two-days / a weekday / a count of days)", () => {
    for (const t of [
      "תזכיר לי בעוד יומיים", // "in two days" — contains יומי but not a daily phrase
      "כל יומיים להשקות", // "every TWO days" — יום followed by another Hebrew letter
      "כל יום ראשון חוג", // "every SUNDAY" — that's WEEKLY, not daily
      "מדי יום שני פגישה", // "every MONDAY" — weekly
      "פגישה מחר בבוקר", // one-shot, no cadence
    ]) {
      expect(detectStandingDaily(t)).toBe(false);
    }
  });

  it("is empty-safe", () => {
    expect(detectStandingDaily("")).toBe(false);
  });
});
