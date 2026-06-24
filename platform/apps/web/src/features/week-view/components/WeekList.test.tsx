import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WeekDay } from "./WeekList";
import { WeekList } from "./WeekList";

const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

function makeDays(baseIso: string): WeekDay[] {
  return HE_WEEKDAYS.map((label, i) => {
    const d = new Date(`${baseIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const dateIso = d.toISOString().slice(0, 10);
    return {
      dateIso,
      weekdayLabel: label,
      dayLabel: String(d.getUTCDate()),
      events: [] as SavedEvent[],
      isToday: false,
      isSelected: false,
      hebrewDate: "",
      holidays: [] as string[],
    };
  });
}

describe("WeekList", () => {
  it("renders exactly 7 day rows", () => {
    const days = makeDays("2026-06-21");
    render(<WeekList days={days} onSelectDate={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(7);
  });

  it("renders weekday labels in DOM order Sunday → Saturday", () => {
    const days = makeDays("2026-06-21");
    render(<WeekList days={days} onSelectDate={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((btn) => {
      // Each button contains the weekday label as the first text node group.
      // We find it by matching HE_WEEKDAYS entries within the button text.
      return HE_WEEKDAYS.find((label) => btn.textContent?.includes(label)) ?? "";
    });
    expect(labels).toEqual([...HE_WEEKDAYS]);
  });
});
