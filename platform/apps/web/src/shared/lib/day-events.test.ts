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

// #284 — the standing bucket: a due standing daily reminder gets ONE home (the קבוע group), computed
// via the shared isStandingDueOn (the digest's window), and never double-listed in the date buckets.
describe("partitionDay — standing bucket (#284)", () => {
  const standingRem = (over: Partial<SavedEvent>): SavedEvent =>
    ev({
      kind: "reminder",
      time: null,
      standing: { cadence: "daily", until: "2026-07-10" },
      ...over,
    });

  it("routes an in-window standing reminder (non-anchor day) into standing, not untimed", () => {
    const { standing, untimed, timed } = partitionDay(
      [standingRem({ id: 1, date_iso: "2026-06-10", title_he: "סנטינל קבוע" })],
      today,
      tomorrow,
    );
    expect(standing.map((e) => e.title_he)).toEqual(["סנטינל קבוע"]);
    expect(untimed).toEqual([]);
    expect(timed).toEqual([]);
  });

  it("never double-lists on the ANCHOR day — standing is the one home", () => {
    const { standing, untimed } = partitionDay(
      [standingRem({ id: 1, date_iso: today, title_he: "עוגן" })],
      today,
      tomorrow,
    );
    expect(standing).toHaveLength(1);
    expect(untimed).toEqual([]);
  });

  it("window end is inclusive; a past-window row drops back to its date bucket rules", () => {
    const untilToday = standingRem({
      id: 1,
      date_iso: "2026-05-21",
      title_he: "עד היום",
      standing: { cadence: "daily", until: today },
    });
    const expired = standingRem({
      id: 2,
      date_iso: "2026-05-01",
      title_he: "פג",
      standing: { cadence: "daily", until: "2026-06-19" },
    });
    const { standing } = partitionDay([untilToday, expired], today, tomorrow);
    expect(standing.map((e) => e.title_he)).toEqual(["עד היום"]);
  });

  it("keeps a done standing reminder in the group (done never ends the series)", () => {
    const { standing } = partitionDay(
      [standingRem({ id: 1, date_iso: "2026-06-10", status: "done" })],
      today,
      tomorrow,
    );
    expect(standing).toHaveLength(1);
  });

  it("sorts standing time-then-title deterministically", () => {
    const { standing } = partitionDay(
      [
        standingRem({ id: 1, date_iso: "2026-06-10", time: null, title_he: "ב" }),
        standingRem({ id: 2, date_iso: "2026-06-10", time: "08:00", title_he: "ג" }),
        standingRem({ id: 3, date_iso: "2026-06-10", time: null, title_he: "א" }),
      ],
      today,
      tomorrow,
    );
    expect(standing.map((e) => e.title_he)).toEqual(["ג", "א", "ב"]);
  });

  it("a standing reminder anchored TOMORROW peeks as tomorrow's item (not yet in קבוע)", () => {
    const { standing, tomorrow: tm } = partitionDay(
      [standingRem({ id: 1, date_iso: tomorrow, title_he: "מתחיל מחר" })],
      today,
      tomorrow,
    );
    expect(standing).toEqual([]);
    expect(tm).toEqual([{ time: null, title: "מתחיל מחר" }]);
  });
});

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

  it("demotes an overdue TIMED task into the anytime rail (its past time is moot)", () => {
    const overdueTimed = task({
      id: 40,
      date_iso: "2026-06-19",
      time: "14:00",
      title_he: "תור שהוחמץ",
    });
    const ranked = prioritizeUntimed([], [overdueTimed], today, today);
    expect(ranked.map((r) => r.event.id)).toEqual([40]); // carries forward despite having had a time
    expect(ranked[0]?.bucket).toBe("overdue");
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
