import { describe, expect, it } from "vitest";
import { greetingHe, hebDateLong } from "./greeting";

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
