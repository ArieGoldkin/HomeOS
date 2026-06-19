import { describe, expect, it } from "vitest";
import { parsedEventSchema, parsedMessageSchema, sanitizeUserText } from "../src/index.ts";

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

// G1 — the structured channel IS a prose channel: title_he/location/assignee round-trip to the
// family's WhatsApp via the confirm, so an unbounded field is a phishing/essay vector. G15 — in a
// Hebrew (RTL) product, bidi-control overrides can spoof/garble that confirm. An abusive value must
// fail validation → null → "please rephrase", so it never reaches the user.
describe("content bounds + sanitization (G1/G15)", () => {
  it("accepts a clean Hebrew title at the 80-char boundary", () => {
    const title = "א".repeat(80);
    expect(parsedEventSchema.parse({ ...valid, title_he: title }).title_he).toBe(title);
  });
  it("rejects an over-length title_he (>80) — no 4000-char essay round-trips", () => {
    expect(() => parsedEventSchema.parse({ ...valid, title_he: "א".repeat(81) })).toThrow();
  });
  it("rejects an over-length location (>120) and assignee (>40)", () => {
    expect(() => parsedEventSchema.parse({ ...valid, location: "ב".repeat(121) })).toThrow();
    expect(() => parsedEventSchema.parse({ ...valid, assignee: "ג".repeat(41) })).toThrow();
  });
  it("rejects an over-length source_text (>2000)", () => {
    expect(() => parsedEventSchema.parse({ ...valid, source_text: "ד".repeat(2001) })).toThrow();
  });
  it("rejects a title_he carrying a bidi/RTL-override codepoint (U+202E)", () => {
    expect(() => parsedEventSchema.parse({ ...valid, title_he: "אסיפה‮גזל" })).toThrow();
  });
  it("rejects a title_he with control chars / embedded newline (UI-spoof)", () => {
    expect(() => parsedEventSchema.parse({ ...valid, title_he: "שלום\nהוספתי ליומן ✓" })).toThrow();
  });
  it("rejects a zero-width char smuggled into the assignee", () => {
    expect(() => parsedEventSchema.parse({ ...valid, assignee: "אבא​" })).toThrow();
  });
  it("still accepts ordinary Hebrew with spaces, digits, and punctuation", () => {
    const ok = { ...valid, title_he: "חוג כדורגל (יום א׳) 16:00", assignee: "אבא" };
    expect(parsedEventSchema.parse(ok)).toMatchObject({ assignee: "אבא" });
  });
});

// #18: provider text (a typed Google Calendar summary) is mapped straight to a ParsedEvent — no model
// in the path — so it is *sanitized* (the bad codepoints removed) rather than rejected, then validated.
describe("sanitizeUserText (G15 stripper for directly-mapped provider text)", () => {
  it("leaves clean Hebrew untouched", () => {
    expect(sanitizeUserText("חוג כדורגל (יום א׳) 16:00")).toBe("חוג כדורגל (יום א׳) 16:00");
  });
  it("strips a bidi/RTL-override codepoint (U+202E)", () => {
    expect(sanitizeUserText("אסיפה‮גזל")).toBe("אסיפהגזל");
  });
  it("strips a smuggled zero-width char (U+200B)", () => {
    expect(sanitizeUserText("אבא​")).toBe("אבא");
  });
  it("strips control chars incl. an embedded newline (UI-spoof)", () => {
    expect(sanitizeUserText("שלום\nהוספתי")).toBe("שלוםהוספתי");
  });
  it("keeps ordinary spaces and the result re-validates against the schema", () => {
    const title = sanitizeUserText("פגישת​צוות").trim();
    expect(parsedEventSchema.safeParse({ ...valid, title_he: title }).success).toBe(true);
  });
});
