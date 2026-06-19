import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PeekRow } from "./PeekRow";

describe("PeekRow", () => {
  it("renders the time and title", () => {
    render(<PeekRow time="08:15" title="חוג שחייה" />);
    expect(screen.getByText("08:15")).toBeInTheDocument();
    expect(screen.getByText("חוג שחייה")).toBeInTheDocument();
  });

  it("wraps the time dir=ltr with tabular-nums", () => {
    render(<PeekRow time="08:15" title="x" />);
    const t = screen.getByText("08:15");
    expect(t).toHaveAttribute("dir", "ltr");
    expect(t.className).toMatch(/tabular-nums/);
  });

  it("falls back to an em-dash for an untimed item", () => {
    render(<PeekRow time={null} title="לקנות מתנה" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("uses logical properties only (no physical left/right)", () => {
    const { container } = render(<PeekRow time="08:15" title="x" />);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/\b-?(left|right)-/);
  });

  it("merges a caller className", () => {
    const { container } = render(<PeekRow time="08:15" title="x" className="opacity-70" />);
    expect((container.firstChild as HTMLElement).className).toContain("opacity-70");
  });
});
