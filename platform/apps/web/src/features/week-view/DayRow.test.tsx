import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DayRow } from "./DayRow";

const makeEvent = (id: number, assignee: string | null = null): SavedEvent => ({
  id,
  kind: "event",
  title_he: `אירוע ${id}`,
  date_iso: "2026-06-21",
  time: null,
  location: null,
  assignee,
  recurrence: null,
  source_text: "",
  source_provider: null,
});

describe("DayRow", () => {
  it("renders the weekday label and day number", () => {
    render(
      <DayRow
        dateIso="2026-06-21"
        weekdayLabel="ראשון"
        dayLabel="21"
        events={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("ראשון")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
  });

  it("renders one pip per event", () => {
    const events = [makeEvent(1, "אמא"), makeEvent(2, "אבא"), makeEvent(3)];
    render(
      <DayRow
        dateIso="2026-06-21"
        weekdayLabel="ראשון"
        dayLabel="21"
        events={events}
        onSelect={vi.fn()}
      />,
    );
    // Pips are aria-hidden spans — find by their inline style presence.
    // They are siblings inside the end-side container, all aria-hidden.
    const pips = document.querySelectorAll("span[aria-hidden='true'][class*='rounded-full']");
    expect(pips).toHaveLength(3);
  });

  it("clicking the row calls onSelect with the correct dateIso", async () => {
    const onSelect = vi.fn();
    render(
      <DayRow
        dateIso="2026-06-21"
        weekdayLabel="ראשון"
        dayLabel="21"
        events={[makeEvent(1)]}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("2026-06-21");
  });

  it("caps visible pips at MAX_PIPS (5) and shows a +N overflow label", () => {
    const events = Array.from({ length: 7 }, (_, i) => makeEvent(i + 1));
    render(
      <DayRow
        dateIso="2026-06-21"
        weekdayLabel="ראשון"
        dayLabel="21"
        events={events}
        onSelect={vi.fn()}
      />,
    );
    const pips = document.querySelectorAll("span[aria-hidden='true'][class*='rounded-full']");
    expect(pips).toHaveLength(5);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows an em-dash and no pips when there are no events", () => {
    render(
      <DayRow
        dateIso="2026-06-21"
        weekdayLabel="ראשון"
        dayLabel="21"
        events={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    const pips = document.querySelectorAll("span[aria-hidden='true'][class*='rounded-full']");
    expect(pips).toHaveLength(0);
  });
});
