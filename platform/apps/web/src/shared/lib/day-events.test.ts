import type { SavedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { curateTimed, partitionDay, prioritizeUntimed } from "./day-events";

const ev = (over: Partial<SavedEvent>): SavedEvent => ({
  kind: "event",
  title_he: "x",
  date_iso: "2026-06-20",
  time: "09:00",
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "",
  id: 1,
  source_provider: null,
  ...over,
});

const today = "2026-06-20";
const tomorrow = "2026-06-21";

describe("partitionDay", () => {
  it("splits today into timed/untimed and drops other days", () => {
    const {
      timed,
      untimed,
      tomorrow: tm,
    } = partitionDay(
      [
        ev({ id: 1, date_iso: today, time: "09:00", title_he: "בוקר" }),
        ev({ id: 2, date_iso: today, time: null, title_he: "משימה" }),
        ev({ id: 3, date_iso: "2026-06-25", time: "10:00", title_he: "אחר" }),
        ev({ id: 4, date_iso: tomorrow, time: "08:00", title_he: "מחר" }),
      ],
      today,
      tomorrow,
    );
    expect(timed.map((e) => e.title_he)).toEqual(["בוקר"]);
    expect(untimed.map((e) => e.title_he)).toEqual(["משימה"]);
    expect(tm).toEqual([{ time: "08:00", title: "מחר" }]);
  });

  it("sorts timed events ascending by time", () => {
    const { timed } = partitionDay(
      [
        ev({ id: 1, date_iso: today, time: "14:00", title_he: "ב" }),
        ev({ id: 2, date_iso: today, time: "09:00", title_he: "א" }),
      ],
      today,
      tomorrow,
    );
    expect(timed.map((e) => e.title_he)).toEqual(["א", "ב"]);
  });
});

describe("prioritizeUntimed (#20)", () => {
  // today = 2026-06-20. Untimed items for the selected day are passed as `todayUntimed`; overdue is
  // gleaned from the full list. tags: overdue → today → done.
  const task = (over: Partial<SavedEvent>): SavedEvent =>
    ev({ kind: "task", time: null, status: "open", ...over });

  it("sinks done items below open ones (selected day = today)", () => {
    const untimed = [
      task({ id: 1, title_he: "פתוחה", status: "open" }),
      task({ id: 2, title_he: "בוצעה", status: "done" }),
    ];
    const ranked = prioritizeUntimed(untimed, untimed, today, today);
    expect(ranked.map((r) => r.bucket)).toEqual(["today", "done"]);
    expect(ranked.map((r) => r.event.id)).toEqual([1, 2]);
  });

  it("carries overdue OPEN TASKS forward to the top, oldest first (today view only)", () => {
    const overdueOld = task({ id: 10, date_iso: "2026-06-18", title_he: "ישנה" });
    const overdueNew = task({ id: 11, date_iso: "2026-06-19", title_he: "אתמול" });
    const todayOpen = task({ id: 1, date_iso: today, title_he: "היום" });
    const all = [todayOpen, overdueNew, overdueOld];
    const ranked = prioritizeUntimed([todayOpen], all, today, today);
    expect(ranked.map((r) => r.bucket)).toEqual(["overdue", "overdue", "today"]);
    expect(ranked.map((r) => r.event.id)).toEqual([10, 11, 1]); // oldest overdue first
  });

  it("does NOT carry overdue when the selected day is not today", () => {
    const overdue = task({ id: 10, date_iso: "2026-06-18", title_he: "ישנה" });
    const dayOpen = task({ id: 1, date_iso: today, title_he: "היום" });
    // selected = today (2026-06-20) but the real anchor is a later day → today's items are not "today"
    const ranked = prioritizeUntimed([dayOpen], [dayOpen, overdue], today, "2026-06-25");
    expect(ranked.map((r) => r.event.id)).toEqual([1]); // no carry-forward
    expect(ranked.every((r) => r.bucket === "today")).toBe(true);
  });

  it("never carries a past EVENT or REMINDER — only tasks", () => {
    const pastEvent = ev({ id: 20, kind: "event", time: null, date_iso: "2026-06-18" });
    const pastReminder = ev({ id: 21, kind: "reminder", time: null, date_iso: "2026-06-18" });
    const pastTask = task({ id: 22, date_iso: "2026-06-18", title_he: "משימה ישנה" });
    const ranked = prioritizeUntimed([], [pastEvent, pastReminder, pastTask], today, today);
    expect(ranked.map((r) => r.event.id)).toEqual([22]); // only the task carries
    expect(ranked[0]?.bucket).toBe("overdue");
  });

  it("never carries a past task that is already done", () => {
    const doneOld = task({ id: 30, date_iso: "2026-06-18", status: "done" });
    const ranked = prioritizeUntimed([], [doneOld], today, today);
    expect(ranked).toEqual([]); // done past task stays in the past
  });
});

describe("curateTimed", () => {
  const mk = (n: number, t: string) => ev({ id: n, time: t, title_he: `e${n}` });

  it("shows everything when within the cap, no extras", () => {
    const { shown, moreCount } = curateTimed([mk(1, "08:00"), mk(2, "09:00")], "08:30", 5);
    expect(shown.length).toBe(2);
    expect(moreCount).toBe(0);
  });

  it("windows around now (one past + upcoming) and reports the hidden count", () => {
    const timed = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"].map((t, i) =>
      mk(i + 1, t),
    );
    const { shown, moreCount } = curateTimed(timed, "11:00", 5);
    expect(shown.length).toBe(5);
    expect(moreCount).toBe(2);
    expect(shown[0]?.time).toBe("10:00"); // one past event for context
  });
});
