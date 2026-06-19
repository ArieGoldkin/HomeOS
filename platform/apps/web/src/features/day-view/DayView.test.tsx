import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DayView } from "./DayView";

const ev = (over: Partial<SavedEvent>): SavedEvent => ({
  kind: "event",
  title_he: "x",
  date_iso: "2026-06-20",
  time: "09:00",
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "",
  id: 1,
  source_provider: null,
  ...over,
});

const base = {
  status: "ready" as const,
  timed: [] as SavedEvent[],
  untimed: [] as SavedEvent[],
  tomorrow: [] as { time: string | null; title: string }[],
  nowTime: "12:00",
};

describe("DayView", () => {
  it("shows skeletons while loading", () => {
    const { container } = render(<DayView {...base} status="loading" />);
    expect(container.querySelector(".bg-secondary")).not.toBeNull();
  });

  it("shows an error message on error", () => {
    render(<DayView {...base} status="error" />);
    expect(screen.getByText(/שגיאה/)).toBeInTheDocument();
  });

  it("renders timed (TimeSpine + NowLine), untimed tasks, and tomorrow peek", () => {
    render(
      <DayView
        status="ready"
        timed={[ev({ id: 1, time: "09:00", title_he: "בוקר" })]}
        untimed={[ev({ id: 2, time: null, kind: "task", title_he: "משימה" })]}
        tomorrow={[{ time: "08:00", title: "חוג שחייה" }]}
        nowTime="12:00"
      />,
    );
    expect(screen.getByText("בוקר")).toBeInTheDocument();
    expect(screen.getByText("now · 12:00")).toBeInTheDocument();
    expect(screen.getByText("משימה")).toBeInTheDocument();
    expect(screen.getByText("חוג שחייה")).toBeInTheDocument();
  });

  it("shows a +N more cue when events were curated away", () => {
    render(<DayView {...base} status="ready" timed={[ev({ id: 1 })]} moreCount={3} />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing today", () => {
    render(<DayView {...base} status="ready" />);
    expect(screen.getByText(/אין אירועים/)).toBeInTheDocument();
  });
});
