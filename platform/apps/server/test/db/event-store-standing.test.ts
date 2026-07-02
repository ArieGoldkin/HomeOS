import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { createEventStore } from "../../src/db/event-store/index.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

// A minimal standing-daily reminder anchored on `date`. The parser's lexical gate would have set `standing`.
function standingReminder(date: string, title = "לשתות מים"): ParsedEvent {
  return {
    kind: "reminder",
    title_he: title,
    date_iso: date,
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: `תזכיר לי ${title} באופן קבוע`,
    standing: { cadence: "daily" },
  };
}

function oneShotReminder(date: string): ParsedEvent {
  return {
    kind: "reminder",
    title_he: "תור לרופא",
    date_iso: date,
    time: "09:00",
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "תזכיר לי תור לרופא",
    standing: null,
  };
}

let seq = 0;
function save(store: ReturnType<typeof createEventStore>, ev: ParsedEvent) {
  seq += 1;
  return store.saveEvent(ev, { fromPhone: "972500000000", waMessageId: `wamid.${seq}` });
}

describe("event-store — standing daily reminders (#224)", () => {
  it("saveEvent stamps standing_until = anchor + 30d and echoes standing on the row", () => {
    const store = createEventStore(":memory:");
    const saved = save(store, standingReminder("2026-07-01"));
    // #284 — the served row carries the stored window end (was silently dropped pre-#284).
    expect(saved.standing).toEqual({ cadence: "daily", until: "2026-07-31" });
    // Surfaces on the anchor day and is still due 30 days later, but not on day 31.
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-01")).toHaveLength(1);
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-31")).toHaveLength(1); // anchor + 30d = last day
    expect(store.remindersDueOn(FAMILY_ID, "2026-08-01")).toHaveLength(0); // day 31 — past the window
  });

  it("surfaces every in-window day (not just the anchor) — the whole point of #224", () => {
    const store = createEventStore(":memory:");
    save(store, standingReminder("2026-07-01"));
    for (const d of ["2026-07-02", "2026-07-10", "2026-07-20", "2026-07-31"]) {
      expect(store.remindersDueOn(FAMILY_ID, d)).toHaveLength(1);
    }
  });

  it("does NOT surface before the anchor date", () => {
    const store = createEventStore(":memory:");
    save(store, standingReminder("2026-07-01"));
    expect(store.remindersDueOn(FAMILY_ID, "2026-06-30")).toHaveLength(0);
  });

  it("a one-shot reminder is unchanged — only its exact date, never a window", () => {
    const store = createEventStore(":memory:");
    save(store, oneShotReminder("2026-07-01"));
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-01")).toHaveLength(1);
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-02")).toHaveLength(0); // no window for a one-shot
  });

  it("a cancelled (deleted) standing reminder stops surfacing — the existing cancel path just works", () => {
    const store = createEventStore(":memory:");
    const saved = save(store, standingReminder("2026-07-01"));
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-10")).toHaveLength(1);
    expect(store.deleteById(saved.id, FAMILY_ID)).toBe(1); // the agentic cancel path deletes by id
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-10")).toHaveLength(0);
  });

  it("a 'done' toggle does NOT end a standing series — it keeps surfacing (cancel to stop, not done)", () => {
    // A recurring reminder can't be "completed" in one tap; only cancel removes it. So marking day-3 done
    // must not silently kill days 4-30 (the medication-reminder failure the review flagged).
    const store = createEventStore(":memory:");
    const saved = save(store, standingReminder("2026-07-01"));
    store.setEventStatus(saved.id, "done", FAMILY_ID);
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-10")).toHaveLength(1);
  });

  it("editing the anchor date RE-ANCHORS the window (standing_until follows the new date)", () => {
    const store = createEventStore(":memory:");
    const saved = save(store, standingReminder("2026-07-01")); // window → 2026-07-31
    store.updateEvent(saved.id, { date_iso: "2026-08-15" }, FAMILY_ID); // move it forward
    expect(store.remindersDueOn(FAMILY_ID, "2026-07-20")).toHaveLength(0); // old window no longer matches
    expect(store.remindersDueOn(FAMILY_ID, "2026-08-20")).toHaveLength(1); // new window is live
    expect(store.remindersDueOn(FAMILY_ID, "2026-09-14")).toHaveLength(1); // new anchor + 30d
    expect(store.remindersDueOn(FAMILY_ID, "2026-09-15")).toHaveLength(0); // past the re-anchored window
  });
});
