import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RuleBar } from "./RuleBar";

describe("RuleBar", () => {
  it("renders a thin primary rule, hidden from the a11y tree", () => {
    const { container } = render(<RuleBar />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("bg-primary");
  });

  // The "trust cue" rule draws in along --draw-origin (set once on <html>: right→left under RTL).
  it("uses the RTL-aware draw-rule signature", () => {
    const { container } = render(<RuleBar />);
    expect((container.firstChild as HTMLElement).className).toContain("draw-rule");
  });

  // Logical properties only — the atom must not pin itself with physical left/right.
  it("stays on the block axis (no physical left/right positioning)", () => {
    const { container } = render(<RuleBar />);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/\b-?(left|right)-/);
  });

  it("merges a caller className", () => {
    const { container } = render(<RuleBar className="mb-2" />);
    expect((container.firstChild as HTMLElement).className).toContain("mb-2");
  });
});
