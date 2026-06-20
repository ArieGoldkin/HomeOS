import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "event", label: "אירוע" },
  { value: "reminder", label: "תזכורת" },
  { value: "task", label: "משימה" },
];

describe("SegmentedControl", () => {
  it("renders all options as radio buttons", () => {
    render(<SegmentedControl value="event" onValueChange={vi.fn()} options={OPTIONS} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "אירוע" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "תזכורת" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "משימה" })).toBeInTheDocument();
  });

  it("the selected option has aria-checked=true", () => {
    render(<SegmentedControl value="reminder" onValueChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "תזכורת" })).toHaveAttribute("aria-checked", "true");
  });

  it("non-selected options have aria-checked=false", () => {
    render(<SegmentedControl value="reminder" onValueChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "אירוע" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "משימה" })).toHaveAttribute("aria-checked", "false");
  });

  it("clicking an unselected option calls onValueChange with its value", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SegmentedControl value="event" onValueChange={handleChange} options={OPTIONS} />);
    await user.click(screen.getByRole("radio", { name: "משימה" }));
    expect(handleChange).toHaveBeenCalledWith("task");
  });

  it("clicking the already-selected option still calls onValueChange", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SegmentedControl value="event" onValueChange={handleChange} options={OPTIONS} />);
    await user.click(screen.getByRole("radio", { name: "אירוע" }));
    expect(handleChange).toHaveBeenCalledWith("event");
  });

  it("selected segment has bg-primary class", () => {
    render(<SegmentedControl value="task" onValueChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "משימה" }).className).toMatch(/bg-primary/);
  });

  it("unselected segments do not have bg-primary class", () => {
    render(<SegmentedControl value="task" onValueChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "אירוע" }).className).not.toMatch(/bg-primary/);
  });

  it("container has role=radiogroup", () => {
    render(
      <SegmentedControl value="event" onValueChange={vi.fn()} options={OPTIONS} aria-label="סוג" />,
    );
    expect(screen.getByRole("radiogroup", { name: "סוג" })).toBeInTheDocument();
  });

  it("accepts a custom className on the container", () => {
    render(
      <SegmentedControl
        value="event"
        onValueChange={vi.fn()}
        options={OPTIONS}
        className="my-extra-class"
      />,
    );
    expect(screen.getByRole("radiogroup").className).toContain("my-extra-class");
  });

  it("uses a roving tabindex — only the selected radio is in the tab order", () => {
    render(<SegmentedControl value="reminder" onValueChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("radio", { name: "תזכורת" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "אירוע" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "משימה" })).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowDown moves selection to the next option", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SegmentedControl value="event" onValueChange={handleChange} options={OPTIONS} />);
    screen.getByRole("radio", { name: "אירוע" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(handleChange).toHaveBeenCalledWith("reminder");
  });

  it("ArrowUp wraps from the first option to the last", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SegmentedControl value="event" onValueChange={handleChange} options={OPTIONS} />);
    screen.getByRole("radio", { name: "אירוע" }).focus();
    await user.keyboard("{ArrowUp}");
    expect(handleChange).toHaveBeenCalledWith("task");
  });

  it("Home/End jump to the first/last option", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SegmentedControl value="reminder" onValueChange={handleChange} options={OPTIONS} />);
    screen.getByRole("radio", { name: "תזכורת" }).focus();
    await user.keyboard("{End}");
    expect(handleChange).toHaveBeenLastCalledWith("task");
    await user.keyboard("{Home}");
    expect(handleChange).toHaveBeenLastCalledWith("event");
  });

  it("RTL flips the horizontal arrows (ArrowLeft advances, ArrowRight retreats)", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <div dir="rtl">
        <SegmentedControl value="event" onValueChange={handleChange} options={OPTIONS} />
      </div>,
    );
    screen.getByRole("radio", { name: "אירוע" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(handleChange).toHaveBeenLastCalledWith("reminder"); // forward in RTL
    await user.keyboard("{ArrowRight}");
    expect(handleChange).toHaveBeenLastCalledWith("task"); // backward in RTL wraps to last
  });
});
