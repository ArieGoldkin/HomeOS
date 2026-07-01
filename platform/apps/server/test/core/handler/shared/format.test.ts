import type { SavedEvent } from "@homeos/shared";
import { describe, expect, it } from "vitest";
import { formatConfirm, formatWhen } from "../../../../src/core/handler/shared/format.ts";

const base: SavedEvent = {
  id: 1,
  kind: "reminder",
  title_he: "לשתות מים",
  date_iso: "2026-07-01",
  time: null,
  location: null,
  assignee: null,
  recurrence: null,
  standing: null,
  source_text: "תזכיר לי לשתות מים באופן קבוע",
  source_provider: null,
  status: "open",
};

describe("formatWhen / formatConfirm — cadence markers", () => {
  it("tags a standing daily reminder with (יומי) in the confirm (#224 save-then-confirm)", () => {
    const when = formatWhen({ ...base, standing: { cadence: "daily" } });
    expect(when).toContain("(יומי)");
    expect(formatConfirm([{ ...base, standing: { cadence: "daily" } }])).toContain("(יומי)");
  });

  it("tags a weekly recurrence with (שבועי) — and a plain one-shot gets neither marker", () => {
    expect(formatWhen({ ...base, recurrence: { freq: "weekly", weekday: 2 } })).toContain(
      "(שבועי)",
    );
    const plain = formatWhen(base);
    expect(plain).not.toContain("(יומי)");
    expect(plain).not.toContain("(שבועי)");
  });
});
