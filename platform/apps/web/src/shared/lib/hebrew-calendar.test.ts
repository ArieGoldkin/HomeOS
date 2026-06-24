import { describe, expect, it } from "vitest";
import { hebrewDateLabel, holidaysOn } from "./hebrew-calendar";

describe("hebrewDateLabel", () => {
  it("renders the Hebrew calendar date (no nikud, no year) for a civil date", () => {
    // 2025-11-10 → 19 Cheshvan 5786
    expect(hebrewDateLabel("2025-11-10")).toBe("19 חשון");
  });

  it("returns an empty string for a malformed date", () => {
    expect(hebrewDateLabel("nope")).toBe("");
    expect(hebrewDateLabel("")).toBe("");
  });
});

describe("holidaysOn (Israel scheme)", () => {
  it("returns a major holiday for the day it falls on", () => {
    expect(holidaysOn("2025-10-02")).toEqual(["יום כיפור"]); // Yom Kippur 5786
    expect(holidaysOn("2026-05-22")).toEqual(["שבועות"]); // Shavuot 5786
  });

  it("returns [] on a mundane day", () => {
    expect(holidaysOn("2025-11-10")).toEqual([]);
  });

  it("includes the rabbinic family holidays — Purim", () => {
    expect(holidaysOn("2026-03-03")).toEqual(["פורים"]); // Purim 5786
  });

  // F1 — Chanukah night 1 carries hebcal's EREV flag but is the START of the holiday, so it must show.
  it("shows Chanukah night 1 (EREV-tagged but the holiday's start)", () => {
    expect(holidaysOn("2025-12-14")).toEqual(["חנוכה: א׳ נר"]);
  });

  // F3 — Rosh Hashana is the one event hebcal renders with a year; it's stripped for chip consistency.
  it("strips the trailing year hebcal bakes into Rosh Hashana", () => {
    expect(holidaysOn("2025-09-23")).toEqual(["ראש השנה"]);
  });

  it("uses the Israel scheme — a Diaspora-only second yom-tov day is NOT a holiday here", () => {
    // 2026-04-09 is the 8th day of Pesach: yom tov in the Diaspora, an ordinary day in Israel.
    expect(holidaysOn("2026-04-09")).toEqual([]);
  });

  it("returns [] for a malformed date", () => {
    expect(holidaysOn("nope")).toEqual([]);
  });
});
