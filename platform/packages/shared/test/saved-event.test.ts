import { describe, expect, it } from "vitest";
import {
  eventStatusPatchSchema,
  type SavedEvent,
  savedEventSchema,
  savedEventsResponseSchema,
} from "../src/index.ts";

// Fixtures mirror the server's rowToSaved() output (apps/server/src/db/event-store.ts):
// a SavedEvent is a ParsedEvent + a numeric `id` + a nullable `source_provider`. #151 adds an optional
// derived `source` + `created_at`; the base fixtures omit them (optional → still valid) to prove
// backward-compat. The `: SavedEvent` annotations are the compile-time half of the contract — they fail
// typecheck if the schema/type drift from the server shape.
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

// #151/F4 — a fixture that POPULATES the new optional fields, so the `: SavedEvent` annotation has teeth
// on source/created_at (an omit-everything fixture can't catch drift on optional fields). created_at is
// ISO-8601 UTC, exactly as the server's rowToSaved emits it (F1).
const syncedRow: SavedEvent = {
  ...googleRow,
  id: 7,
  source: "gmail",
  created_at: "2026-06-21T18:03:59Z",
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

  // #151 — created_at is now PART of the served contract (rowToSaved includes it), as ISO-8601 UTC (F1).
  it("retains an ISO-8601 UTC created_at (now part of the contract)", () => {
    const parsed = savedEventSchema.parse({ ...forwardedRow, created_at: "2026-06-21T18:03:59Z" });
    expect(parsed.created_at).toBe("2026-06-21T18:03:59Z");
  });

  // #151/F4 — the populated fixture parses, giving the `: SavedEvent` type guard teeth on the new fields.
  it("parses a fully-populated synced row (source + created_at present)", () => {
    expect(savedEventSchema.parse(syncedRow)).toMatchObject({
      source: "gmail",
      created_at: "2026-06-21T18:03:59Z",
    });
  });

  // #151 — source is optional (server-derived) so older rows stay valid; a present value is validated.
  it("is valid without source/created_at (optional → backward-compatible)", () => {
    const parsed = savedEventSchema.parse(forwardedRow);
    expect(parsed.source).toBeUndefined();
    expect(parsed.created_at).toBeUndefined();
  });

  it("parses each valid source and rejects an unknown one", () => {
    for (const source of ["whatsapp", "web", "gmail", "gcal"] as const) {
      expect(savedEventSchema.parse({ ...forwardedRow, source }).source).toBe(source);
    }
    expect(() => savedEventSchema.parse({ ...forwardedRow, source: "sms" })).toThrow();
  });

  // #19 — status is server-owned + optional (like source/created_at): older rows stay valid, a present
  // value is validated. The server always populates it; the UI treats absence as "open".
  it("is valid without status (optional → older rows default to open in the UI)", () => {
    expect(savedEventSchema.parse(forwardedRow).status).toBeUndefined();
  });

  it("parses each valid status and rejects an unknown one", () => {
    for (const status of ["open", "done"] as const) {
      expect(savedEventSchema.parse({ ...forwardedRow, status }).status).toBe(status);
    }
    expect(() => savedEventSchema.parse({ ...forwardedRow, status: "pending" })).toThrow();
  });
});

describe("eventStatusPatchSchema (the PATCH /events/:id body, #19)", () => {
  it("parses a valid open/done patch", () => {
    expect(eventStatusPatchSchema.parse({ status: "done" }).status).toBe("done");
    expect(eventStatusPatchSchema.parse({ status: "open" }).status).toBe("open");
  });

  it("rejects an unknown status and a missing status", () => {
    expect(() => eventStatusPatchSchema.parse({ status: "archived" })).toThrow();
    expect(() => eventStatusPatchSchema.parse({})).toThrow();
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
