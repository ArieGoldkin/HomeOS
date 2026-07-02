import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnytimeSidebar } from "./AnytimeSidebar";

const task = (over: Partial<SavedEvent>): SavedEvent => ({
  kind: "task",
  title_he: "משימה",
  date_iso: "2026-06-20",
  time: null,
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "",
  id: 1,
  source_provider: null,
  ...over,
});

// #284 — the קבוע (standing daily) section sits between the tasks and the tomorrow peek.
describe("AnytimeSidebar — standing (קבוע) section (#284)", () => {
  const standingRem = (id: number, title: string): SavedEvent =>
    task({
      id,
      kind: "reminder",
      title_he: title,
      standing: { cadence: "daily", until: "2026-07-20" },
    });

  it("renders the קבוע header + reminder cards (with the (יומי) marker) when standing items exist", () => {
    render(<AnytimeSidebar tasks={[]} tomorrow={[]} standing={[standingRem(1, "לשתות מים")]} />);
    expect(screen.getByText("קבוע")).toBeInTheDocument();
    expect(screen.getByText("לשתות מים")).toBeInTheDocument();
    expect(screen.getByText("(יומי)")).toBeInTheDocument();
  });

  it("omits the section entirely when standing is absent", () => {
    render(<AnytimeSidebar tasks={[task({ id: 1 })]} tomorrow={[]} />);
    expect(screen.queryByText("קבוע")).toBeNull();
  });

  // #284 fold (review #295 finding 1) — a TIMED standing reminder shows its time on the board (matching
  // the digest); the group is no longer rendered showTime=false, so the time-then-title sort is honest.
  it("shows the time for a timed standing reminder", () => {
    render(
      <AnytimeSidebar
        tasks={[]}
        tomorrow={[]}
        standing={[{ ...standingRem(1, "כדור"), time: "08:00" }]}
      />,
    );
    const t = screen.getByText("08:00");
    expect(t).toHaveAttribute("dir", "ltr");
  });
});

describe("AnytimeSidebar", () => {
  it("renders both default Hebrew section labels when both have content", () => {
    render(
      <AnytimeSidebar tasks={[task({ id: 1 })]} tomorrow={[{ time: "08:00", title: "חוג" }]} />,
    );
    expect(screen.getByText("משימות להיום")).toBeInTheDocument();
    expect(screen.getByText("מחר")).toBeInTheDocument();
  });

  it("omits the tasks section when there are no tasks", () => {
    render(<AnytimeSidebar tasks={[]} tomorrow={[{ time: "08:00", title: "חוג" }]} />);
    expect(screen.queryByText("משימות להיום")).toBeNull();
    expect(screen.getByText("מחר")).toBeInTheDocument();
  });

  it("omits the tomorrow section when there is no peek", () => {
    render(<AnytimeSidebar tasks={[task({ id: 1, title_he: "משימה" })]} tomorrow={[]} />);
    expect(screen.getByText("משימות להיום")).toBeInTheDocument();
    expect(screen.queryByText("מחר")).toBeNull();
  });

  it("renders anytime tasks as task-variant EventCards (checkbox)", () => {
    const { container } = render(
      <AnytimeSidebar tasks={[task({ id: 1, title_he: "לקנות חלב" })]} tomorrow={[]} />,
    );
    expect(screen.getByText("לקנות חלב")).toBeInTheDocument();
    expect(container.querySelector(".border-input")).not.toBeNull(); // the checkbox
  });

  it("renders tomorrow peek rows with time + title", () => {
    render(<AnytimeSidebar tasks={[]} tomorrow={[{ time: "08:15", title: "חוג שחייה" }]} />);
    expect(screen.getByText("08:15")).toBeInTheDocument();
    expect(screen.getByText("חוג שחייה")).toBeInTheDocument();
  });

  it("accepts custom section labels", () => {
    render(
      <AnytimeSidebar
        tasks={[task({ id: 1 })]}
        tomorrow={[{ time: "08:00", title: "x" }]}
        tasksLabel="Today"
        tomorrowLabel="Tomorrow"
      />,
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });
});
