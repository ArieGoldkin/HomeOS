import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders its label", () => {
    const { getByText } = render(<StatusPill>פעיל</StatusPill>);
    expect(getByText("פעיל")).toBeInTheDocument();
  });

  it("maps each tone to its accent token (wash bg + accent text)", () => {
    const cases: Array<[Parameters<typeof StatusPill>[0]["tone"], string, string]> = [
      ["active", "bg-primary/15", "text-primary"],
      ["pending", "bg-blue/15", "text-blue"],
      ["overdue", "bg-coral/15", "text-coral"],
      ["archived", "bg-muted", "text-muted-foreground"],
    ];
    for (const [tone, bg, text] of cases) {
      const { container } = render(<StatusPill tone={tone}>x</StatusPill>);
      const cls = (container.firstChild as HTMLElement).className;
      expect(cls).toContain(bg);
      expect(cls).toContain(text);
    }
  });

  it("defaults to the active tone", () => {
    const { container } = render(<StatusPill>x</StatusPill>);
    expect((container.firstChild as HTMLElement).className).toContain("text-primary");
  });
});
