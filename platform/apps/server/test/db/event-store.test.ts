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

    // Regression (live bug 2026-06-21): a hint carrying the Hebrew definite article ("הפגישה") missed a
    // bare stored title ("פגישה …") because the single-substring LIKE required the ה to be present. Match
    // per-word with a ה/ו-stripped variant so the prefix no longer breaks the lookup.
    it("matches a definite-article hint against a bare stored title (הפגישה → פגישה)", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(
        { ...event, title_he: "פגישה עם יונתן המסטר של AI", date_iso: "2026-06-22", time: "12:00" },
        { fromPhone: "9725", waMessageId: "a" },
      );
      const found = store.findEventsByRef(FAMILY_ID, {
        titleHint: "הפגישה עם יונתן",
        dateIso: "2026-06-22",
      });
      expect(found).toHaveLength(1);
      expect(found[0]?.title_he).toBe("פגישה עם יונתן המסטר של AI");
    });

    it("still matches a content word that legitimately starts with ה (הורים)", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(
        { ...event, title_he: "אסיפת הורים", date_iso: "2026-06-21" },
        { fromPhone: "9725", waMessageId: "a" },
      );
      const found = store.findEventsByRef(FAMILY_ID, { titleHint: "הורים", dateIso: "2026-06-21" });
      expect(found).toHaveLength(1);
      expect(found[0]?.title_he).toBe("אסיפת הורים");
    });

    it("ANDs multi-word hints — all words must appear (no false positive)", () => {
      const store = createEventStore(":memory:");
      store.saveEvent(
        { ...event, title_he: "פגישה עם יונתן", date_iso: "2026-06-22" },
        { fromPhone: "9725", waMessageId: "a" },
      );
      store.saveEvent(
        { ...event, title_he: "פגישה עם דנה", date_iso: "2026-06-22" },
        { fromPhone: "9725", waMessageId: "b" },
      );
      const found = store.findEventsByRef(FAMILY_ID, { titleHint: "הפגישה עם יונתן" });
      expect(found).toHaveLength(1);
      expect(found[0]?.title_he).toBe("פגישה עם יונתן");
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

describe("findEventsByRef — LIKE wildcard escaping (#125/F3)", () => {
  it("treats % / _ in the title hint as literals, not wildcards", () => {
    const store = createEventStore(":memory:");
    store.saveEvent({ ...event, title_he: "5000 שקל" }, { fromPhone: "9725", waMessageId: "a" });
    store.saveEvent(
      { ...event, title_he: "מבצע 50% הנחה" },
      { fromPhone: "9725", waMessageId: "b" },
    );
    // unescaped, "50%" → LIKE %50%% would also catch "5000 שקל"; escaped, only the literal "50%" matches.
    const found = store.findEventsByRef(FAMILY_ID, { titleHint: "50%" });
    expect(found).toHaveLength(1);
    expect(found[0]?.title_he).toContain("50%");
  });
});

describe("updateEvent (#86 edit in place)", () => {
  it("applies a patch to a board row, re-validates, and returns the updated event", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(
      { ...event, time: "16:00" },
      { fromPhone: "9725", waMessageId: "a" },
    );
    const updated = store.updateEvent(saved.id, { time: "18:00", location: "בית הספר" }, FAMILY_ID);
    expect(updated?.time).toBe("18:00");
    expect(updated?.location).toBe("בית הספר");
    expect(updated?.title_he).toBe(event.title_he); // unchanged fields preserved
    expect(store.listEvents()[0]?.time).toBe("18:00"); // persisted
  });

  it("never updates a 'google' row (returns null, no write)", () => {
    const store = createEventStore(":memory:");
    const g = store.saveEvent(event, {
      fromPhone: "9725",
      waMessageId: "g",
      sourceProvider: "google",
    });
    expect(store.updateEvent(g.id, { time: "09:00" }, FAMILY_ID)).toBeNull();
    expect(store.listEvents()[0]?.time).toBe("18:30"); // untouched
  });

  it("returns null when the merged row fails validation (no write)", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(event, { fromPhone: "9725", waMessageId: "a" });
    expect(store.updateEvent(saved.id, { date_iso: "not-a-date" }, FAMILY_ID)).toBeNull();
    expect(store.listEvents()[0]?.date_iso).toBe("2026-06-20"); // unchanged
  });

  it("returns null for a nonexistent id", () => {
    const store = createEventStore(":memory:");
    expect(store.updateEvent(999, { time: "09:00" }, FAMILY_ID)).toBeNull();
  });
});

describe("findSlotConflict (slot dedup)", () => {
  // event = 2026-06-20 18:30
  const slot = (excludeWaMessageId: string) => ({
    dateIso: event.date_iso,
    time: event.time as string,
    excludeWaMessageId,
  });

  it("returns an existing board row occupying the same (date, time) slot", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.first" });
    // a DIFFERENT message describing the same slot → the existing row is the conflict
    expect(store.findSlotConflict(FAMILY_ID, slot("wamid.other"))?.id).toBe(saved.id);
  });

  it("returns null when the slot is free (different time or different date)", () => {
    const store = createEventStore(":memory:");
    store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.first" });
    expect(
      store.findSlotConflict(FAMILY_ID, {
        dateIso: "2026-06-20",
        time: "09:00",
        excludeWaMessageId: "x",
      }),
    ).toBeNull();
    expect(
      store.findSlotConflict(FAMILY_ID, {
        dateIso: "2026-06-21",
        time: "18:30",
        excludeWaMessageId: "x",
      }),
    ).toBeNull();
  });

  it("excludes the caller's OWN message so a boot-replay never collides with its own rows", () => {
    const store = createEventStore(":memory:");
    store.saveEvent(event, { fromPhone: "9725", waMessageId: "wamid.same" });
    // same wa_message_id is excluded → not a conflict (that row upserts, never duplicates)
    expect(store.findSlotConflict(FAMILY_ID, slot("wamid.same"))).toBeNull();
  });

  it("never matches a provider-derived (synced) row — only board rows are deduped", () => {
    const store = createEventStore(":memory:");
    store.saveEvent(event, {
      fromPhone: "9725",
      waMessageId: "gcal:abc",
      sourceProvider: "google",
    });
    expect(store.findSlotConflict(FAMILY_ID, slot("wamid.other"))).toBeNull();
  });
});

describe("rowToSaved provenance (#151) — derived source + created_at", () => {
  it("derives source from the wa_message_id prefix (gmail/gcal/web/whatsapp)", () => {
    const store = createEventStore(":memory:");
    store.saveEvent({ ...event, title_he: "fwd" }, { fromPhone: "9725", waMessageId: "wamid.fwd" });
    store.saveEvent(
      { ...event, title_he: "webadd" },
      { fromPhone: "9725", waMessageId: "web:abc" },
    );
    store.saveEvent(
      { ...event, title_he: "mail" },
      { fromPhone: "9725", waMessageId: "gmail:m1", sourceProvider: "google" },
    );
    store.saveEvent(
      { ...event, title_he: "cal" },
      { fromPhone: "9725", waMessageId: "gcal:c1", sourceProvider: "google" },
    );
    const all = store.listEvents();
    const src = (t: string) => all.find((e) => e.title_he === t)?.source;
    expect(src("fwd")).toBe("whatsapp");
    expect(src("webadd")).toBe("web");
    expect(src("mail")).toBe("gmail");
    expect(src("cal")).toBe("gcal");
  });

  // F2/F8 — pin the producer-prefix → source map and the startsWith-anchoring (not substring), so a
  // producer changing an idempotency-key prefix breaks a test rather than silently mis-deriving a badge.
  it("falls back to whatsapp for an unknown prefix and matches by startsWith, not substring", () => {
    const store = createEventStore(":memory:");
    store.saveEvent({ ...event, title_he: "unknown" }, { fromPhone: "9725", waMessageId: "sms:x" });
    // contains "gmail:" but does NOT start with it → still a forward, not gmail
    store.saveEvent(
      { ...event, title_he: "contains" },
      { fromPhone: "9725", waMessageId: "wamid.gmail:x" },
    );
    const all = store.listEvents();
    const src = (t: string) => all.find((e) => e.title_he === t)?.source;
    expect(src("unknown")).toBe("whatsapp");
    expect(src("contains")).toBe("whatsapp");
  });

  // F1/F5 — created_at is served as ISO-8601 UTC (not the bare SQLite "YYYY-MM-DD HH:MM:SS"), so a
  // consumer's new Date() reads the right instant. Lock the format AND the round-trip.
  it("serves created_at as ISO-8601 UTC that round-trips through new Date()", () => {
    const store = createEventStore(":memory:");
    const saved = store.saveEvent(event, { fromPhone: "9725", waMessageId: "w1" });
    expect(saved.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const t = new Date(saved.created_at as string).getTime();
    expect(Number.isNaN(t)).toBe(false);
    // within a minute of "now" — proves it parsed as UTC, not shifted by the local offset
    expect(Math.abs(Date.now() - t)).toBeLessThan(60_000);
    expect(saved.source).toBe("whatsapp");
  });
});
