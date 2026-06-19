import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a muted block, hidden from the a11y tree", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toContain("bg-secondary");
  });

  it("defaults to the block variant (rounded-md)", () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).className).toContain("rounded-md");
  });

  it("supports a line variant for text placeholders", () => {
    const { container } = render(<Skeleton variant="line" />);
    expect((container.firstChild as HTMLElement).className).toContain("h-3");
  });

  it("supports a circle variant for avatar placeholders", () => {
    const { container } = render(<Skeleton variant="circle" />);
    expect((container.firstChild as HTMLElement).className).toContain("rounded-full");
  });

  it("merges a caller className for sizing", () => {
    const { container } = render(<Skeleton className="size-24" />);
    expect((container.firstChild as HTMLElement).className).toContain("size-24");
  });

  // DESIGN.md §10: "ruled ink-not-dry skeletons (never shimmer-sweep)".
  it("never shimmer-sweeps (ink-not-dry: no animation/gradient)", () => {
    const { container } = render(<Skeleton />);
    expect((container.firstChild as HTMLElement).className).not.toMatch(
      /animate-|shimmer|gradient/,
    );
  });
});
