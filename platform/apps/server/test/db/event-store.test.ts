import { describe, it, expect } from "vitest";
import type { ParsedEvent } from "@homeos/shared";
import { createEventStore } from "../../src/db/event-store.ts";

const event: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-20",
  time: "18:30",
  location: "גן רימון",
  assignee: null,
  recurrence: null,
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

  it("is idempotent on (wa_message_id, seq) — re-saving returns the same row, no duplicate", () => {
    const store = createEventStore(":memory:");
    const first = store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.dup" });
    const again = store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.dup" });
    expect(again.id).toBe(first.id); // same row back, not a new insert (seq defaults to 0)
    expect(store.listEvents()).toHaveLength(1); // boot-replay can't double-write
  });

  it("stores multiple events from one message under distinct seq", () => {
    const store = createEventStore(":memory:");
    const a = store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.multi", seq: 0 });
    const b = store.saveEvent(
      { ...event, title_he: "טיול שנתי" },
      { fromPhone: "9725", waMessageId: "wamid.multi", seq: 1 },
    );
    expect(b.id).not.toBe(a.id);
    expect(store.listEvents()).toHaveLength(2); // same message, two events — not collapsed
  });

  it("round-trips assignee and weekly recurrence", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(
      { ...event, assignee: "אבא", recurrence: { freq: "weekly", weekday: 2 } },
      { fromPhone: "9725", waMessageId: "wamid.rec" },
    );
    expect(saved.assignee).toBe("אבא");
    expect(saved.recurrence).toEqual({ freq: "weekly", weekday: 2 });
    expect(store.listEvents()[0]).toMatchObject({
      assignee: "אבא",
      recurrence: { freq: "weekly", weekday: 2 },
    });
  });
});
