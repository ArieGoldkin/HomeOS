import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NowLine } from "./NowLine";

describe("NowLine", () => {
  it("renders `now · HH:MM` by default", () => {
    render(<NowLine time="17:48" />);
    expect(screen.getByText("now · 17:48")).toBeInTheDocument();
  });

  // Test note (issue #93): the label is dir=ltr + tabular-nums so the HH:MM reads as a ledger value.
  it("wraps the label dir=ltr with tabular-nums", () => {
    render(<NowLine time="09:05" />);
    const label = screen.getByText("now · 09:05");
    expect(label).toHaveAttribute("dir", "ltr");
    expect(label.className).toMatch(/tabular-nums/);
  });

  it("accepts a localized label (e.g. the Hebrew tablet override)", () => {
    render(<NowLine time="17:48" label="עכשיו" />);
    expect(screen.getByText("עכשיו · 17:48")).toBeInTheDocument();
  });

  it("renders the ocean now-line rule, hidden from the a11y tree", () => {
    const { container } = render(<NowLine time="17:48" />);
    const rule = container.querySelector(".now-line");
    expect(rule).not.toBeNull();
    expect(rule).toHaveAttribute("aria-hidden", "true");
  });

  it("merges a caller className", () => {
    const { container } = render(<NowLine time="17:48" className="my-4" />);
    expect((container.firstChild as HTMLElement).className).toContain("my-4");
  });
});
