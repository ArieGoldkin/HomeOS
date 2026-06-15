import { describe, expect, it } from "vitest";
import { parsedEventSchema, parsedMessageSchema } from "../src/index.ts";

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
  it("defaults assignee and recurrence to null when omitted", () => {
    expect(parsedEventSchema.parse(valid)).toMatchObject({ assignee: null, recurrence: null });
  });
  it("accepts an assignee and a weekly recurrence", () => {
    const parsed = parsedEventSchema.parse({
      ...valid,
      assignee: "אבא",
      recurrence: { freq: "weekly", weekday: 0 }, // Sunday
    });
    expect(parsed.assignee).toBe("אבא");
    expect(parsed.recurrence).toEqual({ freq: "weekly", weekday: 0 });
  });
  it("rejects a recurrence weekday out of range", () => {
    expect(() =>
      parsedEventSchema.parse({ ...valid, recurrence: { freq: "weekly", weekday: 7 } }),
    ).toThrow();
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

describe("parsedMessageSchema", () => {
  it("accepts one message carrying several events", () => {
    const msg = parsedMessageSchema.parse({ events: [valid, { ...valid, title_he: "טיול" }] });
    expect(msg.events).toHaveLength(2);
    expect(msg.events[1]).toMatchObject({ title_he: "טיול", assignee: null });
  });
  it("accepts an empty events list (nothing parseable)", () => {
    expect(parsedMessageSchema.parse({ events: [] }).events).toEqual([]);
  });
});
