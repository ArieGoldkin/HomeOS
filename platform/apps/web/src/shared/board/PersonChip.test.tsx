import { assigneeColor } from "@shared/lib";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonChip } from "./PersonChip";

const styleOf = (el: Element | null) => (el?.getAttribute("style") ?? "").toLowerCase();
// jsdom serializes inline hex colors to rgb(), so compare against that: "#2F7DA6" -> "rgb(47, 125, 166)".
const rgb = (h: string) => {
  const n = Number.parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe("PersonChip", () => {
  it("renders the person's name", () => {
    render(<PersonChip name="אבא" />);
    expect(screen.getByText("אבא")).toBeInTheDocument();
  });

  // AC: PersonChip uses the assignee-color lookup, NEVER a --who-* token.
  it("colors the dot from assigneeColor(name) and emits no --who-* token", () => {
    const { container } = render(<PersonChip name="אבא" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(styleOf(dot)).toContain(rgb(assigneeColor("אבא").light)); // אבא -> #2F7DA6
    expect(container.innerHTML).not.toContain("--who-");
  });

  // AC: ONE component — display + selectable via the `selected` prop (not two components).
  it("is ONE component — `selected` toggles the variant in place", () => {
    const { container, rerender } = render(<PersonChip name="נועה" />);
    const resting = container.firstChild as HTMLElement;
    expect(resting.className).toContain("border-input");
    expect(resting).not.toHaveAttribute("data-selected");

    rerender(<PersonChip name="נועה" selected />);
    const active = container.firstChild as HTMLElement;
    expect(active).toHaveAttribute("data-selected", "true");
    expect(active.className).not.toContain("border-input");
    // selected border uses the person's RUNTIME color (inline), not a token
    expect(styleOf(active)).toContain(rgb(assigneeColor("נועה").light));
  });

  it("uses the night-optimized color set when `night`", () => {
    const { container } = render(<PersonChip name="אבא" night />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(styleOf(dot)).toContain(rgb(assigneeColor("אבא").night)); // #7FB8D6
  });

  it("uses logical properties only (no physical left/right)", () => {
    const { container } = render(<PersonChip name="x" />);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/\b-?(left|right)-/);
  });

  it("merges a caller className", () => {
    const { container } = render(<PersonChip name="x" className="cursor-pointer" />);
    expect((container.firstChild as HTMLElement).className).toContain("cursor-pointer");
  });

  // a11y: a display chip is a non-interactive <span> (no role, not in the tab order).
  it("renders a non-interactive span when there is no onClick", () => {
    const { container } = render(<PersonChip name="אבא" selected />);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe("SPAN");
    expect(el).not.toHaveAttribute("aria-pressed");
    expect(screen.queryByRole("button")).toBeNull();
  });

  // a11y: wired as a selectable toggle (onClick) it becomes a real button that ANNOUNCES its
  // pressed state — not just data-selected (review #115 finding 1).
  it("becomes a button with aria-pressed when given an onClick", () => {
    const onClick = vi.fn();
    render(<PersonChip name="נועה" selected onClick={onClick} />);
    const btn = screen.getByRole("button", { name: /נועה/ });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("announces aria-pressed=false for an unselected interactive chip", () => {
    render(<PersonChip name="יואב" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /יואב/ })).toHaveAttribute("aria-pressed", "false");
  });
});
