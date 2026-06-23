import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children", () => {
    const { getByText } = render(<Card>hello</Card>);
    expect(getByText("hello")).toBeInTheDocument();
  });

  it("defaults to the surface variant (white card + shadow)", () => {
    const { container } = render(<Card>x</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("bg-card");
    expect(el.className).toContain("shadow-card");
    expect(el.className).toContain("rounded-[var(--radius-card)]");
  });

  it("renders the muted variant", () => {
    const { container } = render(<Card variant="muted">x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain("bg-card-muted");
  });

  it("renders the glass variant with the blur backdrop", () => {
    const { container } = render(<Card variant="glass">x</Card>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain("[background:var(--card-glass)]");
    expect(cls).toContain("[backdrop-filter:var(--card-blur)]");
  });

  it("merges a caller className and forwards props", () => {
    const { container } = render(
      <Card className="p-4" data-testid="c">
        x
      </Card>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("p-4");
    expect(el).toHaveAttribute("data-testid", "c");
  });
});
