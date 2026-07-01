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

  // #282 — density cap: the week is a map, not a document. Beyond 3 cards the column collapses
  // to a "+N עוד" toggle; the cap must NEVER silently truncate (the pill always carries the count).
  describe("density cap (#282)", () => {
    const evs = (n: number) => Array.from({ length: n }, (_, i) => ev(i + 1, `סנטינל ${i + 1}`));

    const renderCol = (events: SavedEvent[], onOpenDetail?: (e: SavedEvent) => void) =>
      render(
        <DayColumn
          dateIso="2026-06-21"
          weekdayLabel="ראשון"
          dayLabel="21"
          events={events}
          onOpenDetail={onOpenDetail}
        />,
      );

    it("renders all events with no pill at the cap (3)", () => {
      renderCol(evs(3));
      expect(screen.getByText("סנטינל 3")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /עוד/ })).toBeNull();
    });

    it("caps at 3 and shows '+N עוד' with the exact hidden count", () => {
      renderCol(evs(5));
      expect(screen.getByText("סנטינל 3")).toBeInTheDocument();
      expect(screen.queryByText("סנטינל 4")).toBeNull();
      expect(screen.queryByText("סנטינל 5")).toBeNull();
      const pill = screen.getByRole("button", { name: /עוד/ });
      expect(pill).toHaveTextContent("+2");
      expect(pill).toHaveAttribute("aria-expanded", "false");
    });

    it("never silently truncates — exactly 4 events still yields a '+1' pill", () => {
      renderCol(evs(4));
      expect(screen.queryByText("סנטינל 4")).toBeNull();
      expect(screen.getByRole("button", { name: /עוד/ })).toHaveTextContent("+1");
    });

    it("expands to reveal all events and collapses back", async () => {
      const user = userEvent.setup();
      renderCol(evs(5));
      await user.click(screen.getByRole("button", { name: /עוד/ }));
      expect(screen.getByText("סנטינל 5")).toBeInTheDocument();
      const less = screen.getByRole("button", { name: "הצג פחות" });
      expect(less).toHaveAttribute("aria-expanded", "true");
      await user.click(less);
      expect(screen.queryByText("סנטינל 5")).toBeNull();
      expect(screen.getByRole("button", { name: /עוד/ })).toHaveAttribute("aria-expanded", "false");
    });

    it("renders the hidden count as a dir=ltr tabular atom (RTL-safe)", () => {
      renderCol(evs(5));
      const count = screen.getByText("+2");
      expect(count).toHaveAttribute("dir", "ltr");
      expect(count.className).toMatch(/tabular-nums/);
    });

    it("threads onOpenDetail to cards revealed by expansion", async () => {
      const onOpenDetail = vi.fn();
      const user = userEvent.setup();
      const events = evs(5);
      renderCol(events, onOpenDetail);
      await user.click(screen.getByRole("button", { name: /עוד/ }));
      await user.click(screen.getByRole("button", { name: /סנטינל 5/ }));
      expect(onOpenDetail).toHaveBeenCalledWith(events[4]);
    });
  });
});
