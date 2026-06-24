import type { SavedEvent } from "@homeos/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  // #151 — provenance badge shows on synced rows only; forwards/web stay clean.
  it("shows a provenance badge for a synced (gmail) row, none for a forward", () => {
    const { rerender } = render(<EventCard event={make({ source: "gmail" })} />);
    expect(screen.getByTestId("provider-badge")).not.toBeNull();
    rerender(<EventCard event={make({ source: "whatsapp" })} />);
    expect(screen.queryByTestId("provider-badge")).toBeNull();
  });

  // Interactive ONLY when given onOpenDetail — a presentational contract, not a security boundary (#184).
  describe("onOpenDetail (presentational contract)", () => {
    it("is INERT (no button) when onOpenDetail is omitted", () => {
      render(<EventCard event={make({ title_he: "ישיבה" })} />);
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("becomes a <button> that calls onOpenDetail with the event when provided", () => {
      const onOpenDetail = vi.fn();
      const event = make({ title_he: "אסיפת הורים" });
      render(<EventCard event={event} onOpenDetail={onOpenDetail} data-testid="card-btn" />);
      const btn = screen.getByRole("button");
      expect(btn).toHaveTextContent("אסיפת הורים"); // accessible name from content (kind/title preserved)
      expect(btn).toHaveAttribute("aria-haspopup", "dialog"); // announces it opens the detail drawer
      expect(btn).toHaveAttribute("data-testid", "card-btn"); // F1: props forward to the button branch too
      fireEvent.click(btn);
      expect(onOpenDetail).toHaveBeenCalledWith(event);
    });
  });

  // #19 — the done-toggle: an interactive checkbox on tasks; done-state styling on every surface.
  describe("onToggleDone (task done-toggle)", () => {
    it("renders the task marker as a role=checkbox button (aria-checked from status) only for tasks", () => {
      const onToggleDone = vi.fn();
      const event = make({ kind: "task", title_he: "לקנות חלב", status: "open" });
      render(<EventCard event={event} onToggleDone={onToggleDone} />);
      const box = screen.getByRole("checkbox");
      expect(box).toHaveAttribute("aria-checked", "false");
      fireEvent.click(box);
      expect(onToggleDone).toHaveBeenCalledWith(event);
    });

    it("reflects aria-checked=true and strikes through the title when status is done", () => {
      render(
        <EventCard
          event={make({ kind: "task", title_he: "כביסה", status: "done" })}
          onToggleDone={vi.fn()}
        />,
      );
      expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("כביסה").className).toMatch(/line-through/);
    });

    it("does NOT make a non-task into a checkbox (event ignores onToggleDone)", () => {
      render(
        <EventCard event={make({ kind: "event", title_he: "ישיבה" })} onToggleDone={vi.fn()} />,
      );
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("strikes through a done task even with no toggle handler (read-only surfaces)", () => {
      render(<EventCard event={make({ kind: "task", title_he: "מטלה", status: "done" })} />);
      expect(screen.getByText("מטלה").className).toMatch(/line-through/);
    });

    it("renders the checkbox and the detail button as SIBLINGS (no nested buttons) when both are set", () => {
      render(
        <EventCard
          event={make({ kind: "task", title_he: "חלב" })}
          onToggleDone={vi.fn()}
          onOpenDetail={vi.fn()}
        />,
      );
      const checkbox = screen.getByRole("checkbox");
      // the detail button is the other button; neither contains the other
      const detailBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-haspopup") === "dialog");
      expect(detailBtn).toBeTruthy();
      expect(checkbox.contains(detailBtn as Node)).toBe(false);
      expect((detailBtn as HTMLElement).contains(checkbox)).toBe(false);
    });
  });
});
