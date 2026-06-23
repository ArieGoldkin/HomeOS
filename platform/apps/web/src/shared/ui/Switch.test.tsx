import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("exposes role=switch with aria-checked reflecting state", () => {
    const { rerender } = render(<Switch checked={false} onCheckedChange={() => {}} />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    rerender(<Switch checked={true} onCheckedChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onCheckedChange with the toggled value on click", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("positions the knob via writing-mode-aware flex justification (RTL-safe)", () => {
    const { rerender } = render(<Switch checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole("switch").className).toContain("justify-start");
    rerender(<Switch checked={true} onCheckedChange={() => {}} />);
    const on = screen.getByRole("switch");
    expect(on.className).toContain("justify-end");
    expect(on.className).toContain("bg-primary");
  });

  it("does not fire when disabled", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
