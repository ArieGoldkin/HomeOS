import type { SavedEvent } from "@homeos/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeSpine } from "./TimeSpine";

const make = (over: Partial<SavedEvent>): SavedEvent => ({
  kind: "event",
  title_he: "x",
  date_iso: "2026-06-20",
  time: "09:00",
  location: null,
  assignee: null,
  recurrence: null,
  source_text: "",
  id: Math.floor(Math.random() * 1e6),
  source_provider: null,
  ...over,
});

const idx = (c: HTMLElement, s: string) => (c.textContent ?? "").indexOf(s);

describe("TimeSpine", () => {
  it("renders a row per timed event with its time label and title", () => {
    render(<TimeSpine events={[make({ id: 1, time: "09:00", title_he: "בוקר" })]} />);
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("בוקר")).toBeInTheDocument();
  });

  it("filters out untimed events (those belong in the AnytimeSidebar)", () => {
    render(
      <TimeSpine
        events={[
          make({ id: 1, time: null, title_he: "משימה" }),
          make({ id: 2, time: "08:00", title_he: "תזמון" }),
        ]}
      />,
    );
    expect(screen.queryByText("משימה")).toBeNull();
    expect(screen.getByText("תזמון")).toBeInTheDocument();
  });

  it("sorts events by time ascending", () => {
    const { container } = render(
      <TimeSpine
        events={[
          make({ id: 1, time: "14:00", title_he: "אחהצ" }),
          make({ id: 2, time: "09:00", title_he: "בוקר" }),
        ]}
      />,
    );
    expect(idx(container, "בוקר")).toBeLessThan(idx(container, "אחהצ"));
  });

  it("injects a NowLine before the first event at/after nowTime", () => {
    const { container } = render(
      <TimeSpine
        nowTime="12:00"
        events={[
          make({ id: 1, time: "09:00", title_he: "בוקר" }),
          make({ id: 2, time: "14:00", title_he: "אחהצ" }),
        ]}
      />,
    );
    expect(screen.getByText("now · 12:00")).toBeInTheDocument();
    expect(idx(container, "בוקר")).toBeLessThan(idx(container, "now · 12:00"));
    expect(idx(container, "now · 12:00")).toBeLessThan(idx(container, "אחהצ"));
  });

  it("applies compact row spacing when density=compact", () => {
    const { container } = render(
      <TimeSpine density="compact" events={[make({ id: 1, time: "09:00" })]} />,
    );
    expect(container.querySelector(".py-2")).not.toBeNull();
  });
});
