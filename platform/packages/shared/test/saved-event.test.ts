import { describe, expect, it } from "vitest";
import { type SavedEvent, savedEventSchema, savedEventsResponseSchema } from "../src/index.ts";

// Fixtures mirror the server's rowToSaved() output (apps/server/src/db/event-store.ts:40):
// a SavedEvent is a ParsedEvent + a numeric `id` + a nullable `source_provider`. `created_at`
// is intentionally DROPPED by rowToSaved, so it is absent from the served row (and from here).
// The `: SavedEvent` annotations are the compile-time half of the contract — they fail typecheck
// if the schema/type drift from the server shape (id number, source_provider string|null).
const forwardedRow: SavedEvent = {
  id: 1,
  kind: "event",
  title_he: "אסיפת הורים בגן",
  date_iso: "2026-06-20",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
  source_text: "תזכורת: אסיפת הורים ביום שישי ב-18:30 בגן רימון",
  source_provider: null, // forwarded WhatsApp event — the common case
};

const googleRow: SavedEvent = {
  ...forwardedRow,
  id: 42,
  title_he: "תור לרופא",
  source_provider: "google", // gcal/gmail-derived row (#61)
};

describe("savedEventSchema (the served GET /events row)", () => {
  it("parses a real forwarded row (numeric id, null source_provider)", () => {
    expect(savedEventSchema.parse(forwardedRow)).toMatchObject({ id: 1, source_provider: null });
  });

  it("parses a google-derived row (source_provider: 'google')", () => {
    expect(savedEventSchema.parse(googleRow)).toMatchObject({ id: 42, source_provider: "google" });
  });

  it("rejects a string id (the row uses a numeric id, not a string)", () => {
    expect(() => savedEventSchema.parse({ ...forwardedRow, id: "1" })).toThrow();
  });

  it("rejects a non-integer id", () => {
    expect(() => savedEventSchema.parse({ ...forwardedRow, id: 1.5 })).toThrow();
  });

  it("requires source_provider to be present (nullable, not optional)", () => {
    const { source_provider: _omitted, ...withoutProvider } = forwardedRow;
    expect(() => savedEventSchema.parse(withoutProvider)).toThrow();
  });

  it("strips a created_at if present — it is NOT part of the served contract", () => {
    const parsed = savedEventSchema.parse({ ...forwardedRow, created_at: "2026-06-19T10:00:00Z" });
    expect(parsed).not.toHaveProperty("created_at");
  });
});

describe("savedEventsResponseSchema (the GET /events envelope)", () => {
  it("parses the wrapped { events: [...] } shape", () => {
    const parsed = savedEventsResponseSchema.parse({ events: [forwardedRow, googleRow] });
    expect(parsed.events).toHaveLength(2);
  });

  it("rejects a bare array — the payload must be wrapped", () => {
    expect(() => savedEventsResponseSchema.parse([forwardedRow])).toThrow();
  });
});
