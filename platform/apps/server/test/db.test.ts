import { describe, it, expect } from "vitest";
import type { ParsedEvent } from "@homeos/shared";
import { createEventStore } from "../src/db.ts";

const event: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-20",
  time: "18:30",
  location: "גן רימון",
  source_text: "אסיפת הורים ביום שישי ב-18:30",
};

describe("EventStore (in-memory SQLite)", () => {
  it("saves an event and reads it back", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(event, { fromPhone: "972501234567", waMessageId: "wamid.1" });
    expect(saved.id).toBeGreaterThan(0);
    expect(saved).toMatchObject({ kind: "event", title_he: "אסיפת הורים", date_iso: "2026-06-20" });

    const all = store.listEvents();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ title_he: "אסיפת הורים", time: "18:30" });
  });

  it("persists null time and location", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(
      { ...event, time: null, location: null },
      { fromPhone: "972501234567", waMessageId: "wamid.2" },
    );
    expect(saved.time).toBeNull();
    expect(saved.location).toBeNull();
  });

  it("autoincrements ids across saves", () => {
    const store = createEventStore(":memory:");
    const a = store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.A" });
    const b = store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.B" });
    expect(b.id).toBe(a.id + 1);
  });
});
