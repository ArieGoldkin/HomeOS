import { isStandingDueOn, type ParsedEvent, type SavedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { createEventStore } from "../../src/db/event-store/index.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

/**
 * #284 — SQL ≡ TS equivalence: the event-store's `remindersDueStmt` (the authoritative SQL) and the
 * shared `isStandingDueOn` predicate must select the SAME rows, or the digest and the web board drift
 * — exactly the "shows in-app but silent on the digest" bug class the shared fn exists to kill.
 *
 * The SQL has TWO branches; the TS mirror of the one-shot branch lives here (the web already gets
 * one-shots via its date filter — only the STANDING branch ships as a shared fn). If the SQL changes,
 * this matrix breaks loudly and the shared predicate must follow.
 */

// The SQL one-shot branch: ((status IS NULL OR status != 'done') AND date_iso = d), board reminders only.
function isOneShotDueOn(e: SavedEvent, dayIso: string): boolean {
  return (
    e.kind === "reminder" &&
    e.source_provider == null &&
    e.status !== "done" &&
    e.date_iso === dayIso &&
    e.standing?.cadence !== "daily"
  );
}

function reminder(over: Partial<ParsedEvent>): ParsedEvent {
  return {
    kind: "reminder",
    title_he: "תזכורת",
    date_iso: "2026-07-15",
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "תזכיר לי",
    ...over,
  };
}

const standing = (anchor: string, title: string): ParsedEvent =>
  reminder({ title_he: title, date_iso: anchor, standing: { cadence: "daily" } });

describe("standing SQL ≡ TS equivalence (#284)", () => {
  it("remindersDueOn(d) selects exactly the rows the shared predicates select — full matrix", () => {
    const store = createEventStore(":memory:");
    let seq = 0;
    const save = (ev: ParsedEvent, sourceProvider?: string) =>
      store.saveEvent(ev, {
        fromPhone: "972500000000",
        waMessageId: `wamid.${++seq}`,
        sourceProvider,
      });

    const d = "2026-07-15";

    // The matrix — every semantically distinct corner:
    save(standing("2026-07-01", "אמצע חלון")); // anchor < d < until → due
    save(standing(d, "עוגן היום")); // anchor = d → due (standing branch)
    save(standing("2026-06-15", "סוף חלון בדיוק")); // until = 07-15 = d (inclusive) → due
    save(standing("2026-06-01", "חלון שפג")); // until = 07-01 < d → NOT due
    save(standing("2026-07-20", "עוגן עתידי")); // anchor > d → NOT due
    const doneStanding = save(standing("2026-07-10", "קבוע שסומן בוצע")); // done NEVER ends the series → due
    store.setEventStatus(doneStanding.id, "done", FAMILY_ID);
    save(reminder({ title_he: "חד פעמי היום" })); // one-shot on d → due (one-shot branch)
    const doneOneShot = save(reminder({ title_he: "חד פעמי שבוצע" })); // one-shot done → NOT due
    store.setEventStatus(doneOneShot.id, "done", FAMILY_ID);
    save(reminder({ title_he: "חד פעמי מחר", date_iso: "2026-07-16" })); // other day → NOT due
    save(reminder({ title_he: "מסונכרן" }), "google"); // synced provider row → NOT due (board scope)
    save(reminder({ kind: "task", title_he: "משימה לא תזכורת" })); // kind scope → NOT due

    const sqlIds = store
      .remindersDueOn(FAMILY_ID, d)
      .map((r) => r.id)
      .sort((a, b) => a - b);
    const tsIds = store
      .listEvents()
      .filter((e) => isOneShotDueOn(e, d) || isStandingDueOn(e, d))
      .map((e) => e.id)
      .sort((a, b) => a - b);

    expect(sqlIds).toEqual(tsIds);
    // And the matrix isn't vacuous: exactly the 5 due rows survive both sides.
    expect(sqlIds).toHaveLength(5);
  });

  it("agrees on the window boundaries day-by-day across the whole window", () => {
    const store = createEventStore(":memory:");
    store.saveEvent(standing("2026-07-01", "מים"), {
      fromPhone: "972500000000",
      waMessageId: "wamid.b1",
    });

    for (const day of ["2026-06-30", "2026-07-01", "2026-07-15", "2026-07-31", "2026-08-01"]) {
      const sqlDue = store.remindersDueOn(FAMILY_ID, day).length > 0;
      const tsDue = store.listEvents().some((e) => isStandingDueOn(e, day));
      expect(sqlDue, `divergence on ${day}`).toBe(tsDue);
    }
  });
});
