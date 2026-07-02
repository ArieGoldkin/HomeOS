import type { SavedEvent } from "@homeos/shared";
import type { WeekDay } from "@shared/hooks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeekStrip } from "./WeekStrip";

function ev(id: number): SavedEvent {
  return {
    id,
    kind: "event",
    title_he: `סנטינל ${id}`,
    date_iso: "2026-06-21",
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: "",
    source_provider: null,
  };
}

const HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// 2026-06-21 is a Sunday (the same anchor week the DayColumn specs use).
function day(i: number, over: Partial<WeekDay> = {}): WeekDay {
  return {
    dateIso: `2026-06-${21 + i}`,
    weekdayLabel: HE[i] ?? "",
    dayLabel: String(21 + i),
    events: [],
    isToday: false,
    isSelected: false,
    hebrewDate: "",
    holidays: [],
    ...over,
  };
}

const week = (over: Record<number, Partial<WeekDay>> = {}) =>
  Array.from({ length: 7 }, (_, i) => day(i, over[i]));

describe("WeekStrip (#283)", () => {
  it("renders 7 cells in Sunday-first DOM order (dir=rtl places Sunday rightmost — never reversed)", () => {
    render(<WeekStrip days={week()} />);
    const cells = screen.getAllByRole("button");
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveAccessibleName(/ראשון/);
    expect(cells[6]).toHaveAccessibleName(/שבת/);
  });

  it("marks today with aria-current=date and no other cell", () => {
    render(<WeekStrip days={week({ 2: { isToday: true } })} />);
    const today = screen.getByRole("button", { name: /שלישי/ });
    expect(today).toHaveAttribute("aria-current", "date");
    for (const cell of screen.getAllByRole("button")) {
      if (cell !== today) expect(cell).not.toHaveAttribute("aria-current");
    }
  });

  it("caps the dots at 3 for a dense day and renders none for an empty one", () => {
    render(<WeekStrip days={week({ 1: { events: [ev(1), ev(2), ev(3), ev(4), ev(5)] } })} />);
    const dense = screen.getByRole("button", { name: /שני/ });
    expect(dense.querySelectorAll(".rounded-full")).toHaveLength(3);
    const empty = screen.getByRole("button", { name: /חמישי/ });
    expect(empty.querySelectorAll(".rounded-full")).toHaveLength(0);
  });

  it("calls onSelectDay with the tapped day's dateIso", async () => {
    const onSelectDay = vi.fn();
    const user = userEvent.setup();
    render(<WeekStrip days={week()} onSelectDay={onSelectDay} />);
    await user.click(screen.getByRole("button", { name: /רביעי/ }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-06-24");
  });

  it("announces the displayed day as (מוצג) in its accessible name", () => {
    render(<WeekStrip days={week({ 4: { isSelected: true } })} />);
    expect(screen.getByRole("button", { name: /חמישי 25 \(מוצג\)/ })).toBeInTheDocument();
  });

  it("renders the day number as a dir=ltr tabular atom (RTL-safe)", () => {
    render(<WeekStrip days={week()} />);
    const num = screen.getByText("23");
    expect(num).toHaveAttribute("dir", "ltr");
    expect(num.className).toMatch(/tabular-nums/);
  });
});
