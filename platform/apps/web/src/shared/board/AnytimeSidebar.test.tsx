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

describe("AnytimeSidebar", () => {
  it("renders default Hebrew section labels", () => {
    render(<AnytimeSidebar tasks={[]} tomorrow={[]} />);
    expect(screen.getByText("משימות להיום")).toBeInTheDocument();
    expect(screen.getByText("מחר")).toBeInTheDocument();
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
    render(<AnytimeSidebar tasks={[]} tomorrow={[]} tasksLabel="Today" tomorrowLabel="Tomorrow" />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });
});
