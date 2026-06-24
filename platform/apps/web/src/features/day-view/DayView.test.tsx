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

  it("omits the today timed column when nothing is timed (but tomorrow still shows)", () => {
    render(<DayView {...base} status="ready" tomorrow={[{ time: "08:00", title: "חוג מחר" }]} />);
    expect(screen.queryByText("היום")).toBeNull();
    expect(screen.getByText("חוג מחר")).toBeInTheDocument();
  });

  it("shows the today header when there are timed events", () => {
    render(<DayView {...base} status="ready" timed={[ev({ id: 1, time: "09:00" })]} />);
    expect(screen.getByText("היום")).toBeInTheDocument();
  });

  // #153 — onOpenDetail threads to both the timed (TimeSpine) and untimed (AnytimeSidebar) cards; absent
  // ⇒ NO interactive cards (the read-only default — a DayView without onOpenDetail has no affordance).
  it("threads onOpenDetail to timed + untimed cards (and renders none when omitted)", () => {
    const props = {
      ...base,
      status: "ready" as const,
      timed: [ev({ id: 1, time: "09:00", title_he: "בוקר" })],
      untimed: [ev({ id: 2, time: null, kind: "task" as const, title_he: "משימה" })],
    };
    const { rerender } = render(<DayView {...props} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0); // read-only default: inert

    rerender(<DayView {...props} onOpenDetail={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2); // timed + untimed cards now openable
  });
});
