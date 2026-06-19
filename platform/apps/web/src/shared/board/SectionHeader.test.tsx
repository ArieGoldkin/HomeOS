import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "./SectionHeader";

describe("SectionHeader", () => {
  it("renders its children", () => {
    render(<SectionHeader>אירועים היום</SectionHeader>);
    expect(screen.getByText("אירועים היום")).toBeInTheDocument();
  });

  // DESIGN.md §12 anti-slop ban #3: "No all-caps Hebrew section labels."
  // The eyebrow is sentence-case — never uppercased by the component.
  it("is NOT uppercased (no text-transform, casing preserved)", () => {
    render(<SectionHeader>Today · היום</SectionHeader>);
    const el = screen.getByText("Today · היום");
    expect(el.textContent).toBe("Today · היום");
    expect(el.className).not.toMatch(/uppercase/);
    expect(getComputedStyle(el).textTransform).not.toBe("uppercase");
  });

  it("styles as a muted, tracked eyebrow", () => {
    render(<SectionHeader>גן</SectionHeader>);
    const el = screen.getByText("גן");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).toMatch(/tracking-/);
  });

  it("merges a caller className", () => {
    render(<SectionHeader className="mb-3">x</SectionHeader>);
    expect(screen.getByText("x").className).toContain("mb-3");
  });
});
