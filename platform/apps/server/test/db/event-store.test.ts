import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { createEventStore } from "../../src/db/event-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

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

  describe("deleteLastFromSender (undo)", () => {
    it("removes every event of the sender's most recent message, returning the count", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.old" });
      // A later multi-event message from the same sender:
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.new", seq: 0 });
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.new", seq: 1 });

      expect(store.deleteLastFromSender("9725")).toBe(2); // both rows of the last message
      const left = store.listEvents();
      expect(left).toHaveLength(1); // the earlier message survives
      expect(left[0]!.id).toBeDefined();
    });

    it("only touches the requesting sender's events", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(event, { fromPhone: "111", waMessageId: "wamid.a" });
      store.saveEvent(event, { fromPhone: "222", waMessageId: "wamid.b" });
      expect(store.deleteLastFromSender("111")).toBe(1);
      expect(store.listEvents()).toHaveLength(1); // 222's event untouched
    });

    it("returns 0 when the sender has nothing to cancel", () => {
      const store = createEventStore(":memory:");
      expect(store.deleteLastFromSender("999")).toBe(0);
    });
  });

  describe("deleteByProvider (reversibility seam, #61/MF5)", () => {
    it("defaults source_provider to null for forwarded events", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.fwd" });
      expect(store.deleteByProvider("google")).toBe(0); // nothing tagged → nothing purged
      expect(store.listEvents()).toHaveLength(1); // the forwarded event survives
    });

    it("tags a derived event and purges only that provider's rows", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.fwd" }); // untagged
      store.saveEvent(event, {
        fromPhone: "9725",
        waMessageId: "wamid.gmail",
        sourceProvider: "google",
      });
      expect(store.deleteByProvider("google")).toBe(1); // only the google-derived row
      const left = store.listEvents();
      expect(left).toHaveLength(1);
      expect(left[0]!.source_provider).toBeNull(); // the forwarded event remains
    });
  });

  describe("countSince (digest)", () => {
    it("counts events created at/after the cutoff", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.x" });
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.y" });
      expect(store.countSince("2000-01-01 00:00:00")).toBe(2);
      expect(store.countSince("2999-01-01 00:00:00")).toBe(0); // future cutoff → none
    });
  });

  describe("cancel-by-reference seams (#85) — findEventsByRef + deleteById", () => {
    it("matches board rows by time, newest-first, capped at 5, never a 'google' row", () => {
      const store = createEventStore(":memory:");
      // a provider-derived row at the same time must NEVER be returned (source_provider IS NULL only).
      store.saveEvent(
        { ...event, time: "15:30" },
        { fromPhone: "9725", waMessageId: "g1", sourceProvider: "google" },
      );
      const ids: number[] = [];
      for (let i = 0; i < 6; i++) {
        ids.push(
          store.saveEvent({ ...event, time: "15:30" }, { fromPhone: "9725", waMessageId: `w${i}` })
            .id,
        );
      }
      const found = store.findEventsByRef(FAMILY_ID, { time: "15:30" });
      expect(found).toHaveLength(5); // cap 5
      expect(found.every((e) => e.source_provider === null)).toBe(true); // never google
      expect(found[0]?.id).toBe(ids[5]); // newest first (ORDER BY id DESC)
    });

    it("ANDs the provided ref fields (titleHint substring + dateIso)", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(
        { ...event, title_he: "פגישה עם הגננת", date_iso: "2026-06-21" },
        { fromPhone: "9725", waMessageId: "a" },
      );
      store.saveEvent(
        { ...event, title_he: "טיול שנתי", date_iso: "2026-06-21" },
        { fromPhone: "9725", waMessageId: "b" },
      );
      const found = store.findEventsByRef(FAMILY_ID, { titleHint: "גננת", dateIso: "2026-06-21" });
      expect(found).toHaveLength(1);
      expect(found[0]?.title_he).toBe("פגישה עם הגננת");
    });

    it("an empty ref returns the family's board rows (newest-first, cap 5)", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(event, { fromPhone: "9725", waMessageId: "x" });
      expect(store.findEventsByRef(FAMILY_ID, {})).toHaveLength(1);
    });

    it("deleteById removes a board row (returns 1), never a 'google' row (returns 0)", () => {
      const store = createEventStore(":memory:");
      const board = store.saveEvent(event, { fromPhone: "9725", waMessageId: "b1" });
      const google = store.saveEvent(event, {
        fromPhone: "9725",
        waMessageId: "g1",
        sourceProvider: "google",
      });
      expect(store.deleteById(board.id, FAMILY_ID)).toBe(1);
      expect(store.deleteById(google.id, FAMILY_ID)).toBe(0); // source_provider IS NULL only
      expect(store.listEvents().map((e) => e.id)).toEqual([google.id]); // the google row is untouched
    });

    it("deleteById returns 0 for a nonexistent id (idempotent redelivery)", () => {
      const store = createEventStore(":memory:");
      expect(store.deleteById(999, FAMILY_ID)).toBe(0);
    });
  });
});
