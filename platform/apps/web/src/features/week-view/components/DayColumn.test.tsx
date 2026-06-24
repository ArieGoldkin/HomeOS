import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DayColumn } from "./DayColumn";

function ev(id: number, title: string): SavedEvent {
  return {
    id,
    kind: "event",
    title_he: title,
    date_iso: "2026-06-21",
    time: null,
    location: null,
    assignee: null,
    recurrence: null,
    source_text: title,
    source_provider: null,
  };
}

describe("DayColumn", () => {
  it("renders the weekday, day number, and its events", () => {
    render(
      <DayColumn dateIso="2026-06-21" weekdayLabel="ראשון" dayLabel="21" events={[ev(1, "חוג")]} />,
    );
    expect(screen.getByText("ראשון")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("חוג")).toBeInTheDocument();
  });

  it("shows an em-dash when empty and calls onSelect with its date on header tap", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DayColumn
        dateIso="2026-06-22"
        weekdayLabel="שני"
        dayLabel="22"
        events={[]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /שני/ }));
    expect(onSelect).toHaveBeenCalledWith("2026-06-22");
  });

  it("applies the ocean accent to the weekday when isToday", () => {
    render(
      <DayColumn dateIso="2026-06-21" weekdayLabel="ראשון" dayLabel="21" events={[]} isToday />,
    );
    expect(screen.getByText("ראשון")).toHaveClass("text-primary");
  });

  // #25 — Hebrew calendar date + holiday render when supplied.
  it("renders the Hebrew date and any holiday name", () => {
    render(
      <DayColumn
        dateIso="2026-05-22"
        weekdayLabel="שישי"
        dayLabel="22"
        hebrewDate="ו בסיון"
        holidays={["שבועות"]}
        events={[]}
      />,
    );
    expect(screen.getByText("ו בסיון")).toBeInTheDocument();
    expect(screen.getByText("שבועות")).toBeInTheDocument();
  });

  // #153 — onOpenDetail makes the day's EventCards open the drawer (the header button is always present;
  // the CARD becomes a button only when the handler is passed).
  it("threads onOpenDetail so an event card opens the drawer", async () => {
    const onOpenDetail = vi.fn();
    const user = userEvent.setup();
    const event = ev(5, "אסיפת הורים");
    render(
      <DayColumn
        dateIso="2026-06-21"
        weekdayLabel="ראשון"
        dayLabel="21"
        events={[event]}
        onOpenDetail={onOpenDetail}
      />,
    );
    await user.click(screen.getByRole("button", { name: /אסיפת הורים/ }));
    expect(onOpenDetail).toHaveBeenCalledWith(event);
  });
});
