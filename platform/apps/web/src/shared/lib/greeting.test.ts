import { describe, expect, it } from "vitest";
import { greetingHe, hebDateFull, hebDateLong } from "./greeting";

describe("greetingHe", () => {
  // Summer (IDT, UTC+3): the UTC hour + 3 = Jerusalem hour.
  it("says בוקר טוב in the morning", () => {
    expect(greetingHe(new Date("2026-06-22T06:00:00Z"))).toBe("בוקר טוב"); // 09:00 Jerusalem
  });
  it("says צהריים טובים at midday", () => {
    expect(greetingHe(new Date("2026-06-22T11:00:00Z"))).toBe("צהריים טובים"); // 14:00 Jerusalem
  });
  it("says ערב טוב in the evening", () => {
    expect(greetingHe(new Date("2026-06-22T16:00:00Z"))).toBe("ערב טוב"); // 19:00 Jerusalem
  });
  it("says לילה טוב late at night", () => {
    expect(greetingHe(new Date("2026-06-22T23:30:00Z"))).toBe("לילה טוב"); // 02:30 Jerusalem
  });
});

describe("hebDateLong", () => {
  it("formats weekday · day month in Hebrew", () => {
    const s = hebDateLong(new Date("2026-06-22T09:00:00Z")); // Monday 22 June, Jerusalem
    expect(s).toContain("·");
    expect(s).toContain("יוני");
    expect(s).toContain("22");
  });
});

describe("hebDateFull (#206)", () => {
  it("formats a full Hebrew date (weekday, day month, year) for a valid ISO", () => {
    const s = hebDateFull("2026-06-24");
    expect(s).toContain("יום"); // leads with the weekday
    expect(s).toContain("ביוני");
    expect(s).toContain("2026");
  });

  it("returns '' for an empty, malformed, or shape-valid-but-unreal date", () => {
    expect(hebDateFull("")).toBe("");
    expect(hebDateFull("nope")).toBe("");
    expect(hebDateFull("2026-13-45")).toBe(""); // passes the shape regex but is not a real day
  });
});
