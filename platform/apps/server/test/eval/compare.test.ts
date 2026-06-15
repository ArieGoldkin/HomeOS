import type { ParsedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { compareEvent, compareMessage, type ExpectedEvent } from "../../eval/compare.ts";

const actual: ParsedEvent = {
  kind: "event",
  title_he: "אסיפת הורים",
  date_iso: "2026-06-16",
  time: "18:30",
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "...",
};

describe("compareEvent", () => {
  it("matches when date_iso (the strict gate) agrees", () => {
    const expected: ExpectedEvent = { date_iso: "2026-06-16", time: "18:30" };
    expect(compareEvent(expected, actual).matched).toBe(true);
  });

  it("fails on a wrong date_iso (strict diff)", () => {
    const res = compareEvent({ date_iso: "2026-06-17" }, actual);
    expect(res.matched).toBe(false);
    expect(res.diffs[0]).toMatchObject({ field: "date_iso", strict: true });
  });

  it("reports a wrong assignee as a SOFT diff without failing the match", () => {
    const res = compareEvent({ date_iso: "2026-06-16", assignee: "אבא" }, actual);
    expect(res.matched).toBe(true); // date is right → still a pass
    expect(res.diffs).toHaveLength(1);
    expect(res.diffs[0]).toMatchObject({ field: "assignee", strict: false });
  });

  it("fails when the event is missing entirely", () => {
    expect(compareEvent({ date_iso: "2026-06-16" }, undefined).matched).toBe(false);
  });
});

describe("compareMessage", () => {
  it("passes when every event matches and the counts agree", () => {
    const res = compareMessage([{ date_iso: "2026-06-16" }], [actual]);
    expect(res.pass).toBe(true);
  });

  it("fails on a count mismatch (e.g. a multi-event message truncated to one)", () => {
    const res = compareMessage([{ date_iso: "2026-06-16" }, { date_iso: "2026-06-21" }], [actual]);
    expect(res.pass).toBe(false);
    expect(res.countExpected).toBe(2);
    expect(res.countActual).toBe(1);
  });
});
