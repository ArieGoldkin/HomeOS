import type { SavedEvent } from "@homeos/shared";
import type { WeekDay } from "@shared/hooks";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WeekGrid } from "./WeekGrid";

const HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const days: WeekDay[] = HE.map((label, i) => ({
  dateIso: `2026-06-${21 + i}`,
  weekdayLabel: label,
  dayLabel: String(21 + i),
  events: [] as SavedEvent[],
  isToday: i === 0,
  isSelected: false,
}));

describe("WeekGrid", () => {
  it("renders 7 day columns in DOM order [Sunday … Saturday]", () => {
    render(<WeekGrid days={days} />);
    const headers = screen.getAllByRole("button");
    expect(headers).toHaveLength(7);
    // DOM order is Sunday-first … Saturday-last. Under dir=rtl the grid flips this so Sunday renders
    // RIGHTMOST — a layout property jsdom can't measure, asserted here via the DOM order that drives it.
    expect(headers[0]).toHaveTextContent("ראשון");
    expect(headers[6]).toHaveTextContent("שבת");
  });
});
