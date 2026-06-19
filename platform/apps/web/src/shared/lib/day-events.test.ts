import type { SavedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { curateTimed, partitionDay } from "./day-events";

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
