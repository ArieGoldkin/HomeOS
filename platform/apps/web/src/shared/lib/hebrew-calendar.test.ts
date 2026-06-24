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

  it("uses the Israel scheme — a Diaspora-only second yom-tov day is NOT a holiday here", () => {
    // 2026-04-09 is the 8th day of Pesach: yom tov in the Diaspora, an ordinary day in Israel.
    expect(holidaysOn("2026-04-09")).toEqual([]);
  });

  it("returns [] for a malformed date", () => {
    expect(holidaysOn("nope")).toEqual([]);
  });
});
