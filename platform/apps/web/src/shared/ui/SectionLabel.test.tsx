import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionLabel } from "./SectionLabel";

describe("SectionLabel", () => {
  it("renders children", () => {
    const { getByText } = render(<SectionLabel>משק הבית</SectionLabel>);
    expect(getByText("משק הבית")).toBeInTheDocument();
  });

  it("carries the Modern section-label styling (semibold ink, 14.5px)", () => {
    const { container } = render(<SectionLabel>x</SectionLabel>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("font-semibold");
    expect(el.className).toContain("text-[14.5px]");
    expect(el.className).toContain("text-[color:var(--ink)]");
  });

  it("merges a caller className (e.g. px-1) and forwards props", () => {
    const { container } = render(
      <SectionLabel className="px-1" data-testid="label">
        x
      </SectionLabel>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("px-1");
    expect(el.className).toContain("font-semibold");
    expect(el).toHaveAttribute("data-testid", "label");
  });
});
