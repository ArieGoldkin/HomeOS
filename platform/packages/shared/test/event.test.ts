import { describe, it, expect } from "vitest";
import { parsedEventSchema } from "../src/index.ts";

const valid = {
  kind: "event",
  title_he: "אסיפת הורים בגן",
  date_iso: "2026-06-20",
  time: "18:30",
  location: "גן רימון",
  source_text: "תזכורת: אסיפת הורים ביום שישי ב-18:30 בגן רימון",
};

describe("parsedEventSchema", () => {
  it("accepts a valid event", () => {
    expect(parsedEventSchema.parse(valid)).toMatchObject({ kind: "event", date_iso: "2026-06-20" });
  });
  it("allows null time and location (all-day, no place)", () => {
    expect(parsedEventSchema.parse({ ...valid, time: null, location: null })).toBeTruthy();
  });
  it("rejects an invalid kind", () => {
    expect(() => parsedEventSchema.parse({ ...valid, kind: "party" })).toThrow();
  });
  it("rejects a non-ISO date", () => {
    expect(() => parsedEventSchema.parse({ ...valid, date_iso: "20/06/2026" })).toThrow();
  });
  it("rejects an impossible calendar date", () => {
    expect(() => parsedEventSchema.parse({ ...valid, date_iso: "2026-13-40" })).toThrow();
  });
  it("rejects a malformed time", () => {
    expect(() => parsedEventSchema.parse({ ...valid, time: "25:99" })).toThrow();
  });
});
