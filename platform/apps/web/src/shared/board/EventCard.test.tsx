import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventCard } from "./EventCard";

const make = (over: Partial<SavedEvent>): SavedEvent => ({
  kind: "event",
  title_he: "פגישה",
  date_iso: "2026-06-20",
  time: "09:00",
  location: null,
  assignee: "אבא",
  recurrence: null,
  source_text: "",
  id: 1,
  source_provider: null,
  ...over,
});

describe("EventCard (canonical anti-slop spec)", () => {
  // ── kind is encoded by FORM, never a colored left-border (DESIGN.md §12 ban #1) ──
  it("reminder = leading PRIMARY pip + primary-colored title, NOT a colored left-border", () => {
    const { container } = render(
      <EventCard event={make({ kind: "reminder", title_he: "תשלום גן" })} />,
    );
    // an 8px primary pip dot
    expect(container.querySelector(".bg-primary.rounded-full")).not.toBeNull();
    // primary-colored title
    expect(screen.getByText("תשלום גן").className).toContain("text-primary");
    // and emphatically NOT a left/start border
    expect((container.firstChild as HTMLElement).className).not.toMatch(
      /border-[ls]-|border-inline-start/,
    );
  });

  it("task = a checkbox square, title not primary", () => {
    const { container } = render(
      <EventCard event={make({ kind: "task", title_he: "לקנות חלב" })} />,
    );
    expect(container.querySelector(".border-input")).not.toBeNull(); // the 15px checkbox
    expect(container.querySelector(".bg-primary.rounded-full")).toBeNull(); // no reminder pip
    expect(screen.getByText("לקנות חלב").className).not.toContain("text-primary");
  });

  it("event = no marker (no pip, no checkbox)", () => {
    const { container } = render(<EventCard event={make({ kind: "event", title_he: "ישיבה" })} />);
    expect(container.querySelector(".bg-primary.rounded-full")).toBeNull();
    expect(container.querySelector(".border-input")).toBeNull();
  });

  it("renders title_he in the display face", () => {
    render(<EventCard event={make({ title_he: "ארוחת ערב" })} />);
    expect(screen.getByText("ארוחת ערב").className).toContain("font-display");
  });

  it("shows the time dir=ltr + tabular-nums when present", () => {
    render(<EventCard event={make({ time: "14:30" })} />);
    const t = screen.getByText("14:30");
    expect(t).toHaveAttribute("dir", "ltr");
    expect(t.className).toMatch(/tabular-nums/);
  });

  it("suppresses its own time when showTime=false (TimeSpine owns the time column)", () => {
    render(<EventCard event={make({ time: "14:30" })} showTime={false} />);
    expect(screen.queryByText("14:30")).toBeNull();
  });

  it("shows the assignee as a PersonAvatar (initial) + name", () => {
    render(<EventCard event={make({ assignee: "נועה" })} />);
    expect(screen.getByText("נ")).toBeInTheDocument(); // avatar initial
    expect(screen.getByText("נועה")).toBeInTheDocument(); // name
  });

  it("renders location and recurrence when present", () => {
    render(
      <EventCard
        event={make({ location: "תל אביב", recurrence: { freq: "weekly", weekday: 2 } })}
      />,
    );
    expect(screen.getByText("תל אביב")).toBeInTheDocument();
    expect(screen.getByText(/↻/)).toBeInTheDocument();
  });

  // DESIGN.md §13: kind must be conveyed by shape + TEXT, not the visual marker alone — the pip/
  // checkbox are aria-hidden, so a screen-reader-only label carries the kind for assistive tech.
  it("conveys reminder/task kind to assistive tech as text", () => {
    const { rerender } = render(
      <EventCard event={make({ kind: "reminder", title_he: "תשלום" })} />,
    );
    expect(screen.getByText(/תזכורת/)).toBeInTheDocument();

    rerender(<EventCard event={make({ kind: "task", title_he: "חלב" })} />);
    expect(screen.getByText(/משימה/)).toBeInTheDocument();
  });

  it("adds no kind label for a plain event", () => {
    render(<EventCard event={make({ kind: "event", title_he: "ישיבה" })} />);
    expect(screen.queryByText(/תזכורת/)).toBeNull();
    expect(screen.queryByText(/משימה/)).toBeNull();
  });
});
