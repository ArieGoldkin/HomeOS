import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  it("renders with offline aria-label by default", () => {
    render(<StatusDot />);
    expect(screen.getByLabelText("לא מחובר")).toBeInTheDocument();
  });

  it("renders with online aria-label when online=true", () => {
    render(<StatusDot online />);
    expect(screen.getByLabelText("מחובר")).toBeInTheDocument();
  });

  it("applies green class when online", () => {
    render(<StatusDot online data-testid="dot" />);
    const dot = screen.getByTestId("dot");
    // bg-green-500 compiles to a green rgb; just confirm the offline muted class is absent
    expect(dot.className).toContain("bg-green-500");
    expect(dot.className).not.toContain("bg-muted-foreground");
  });

  it("applies muted class when offline", () => {
    render(<StatusDot data-testid="dot" />);
    const dot = screen.getByTestId("dot");
    expect(dot.className).toContain("bg-muted-foreground");
    expect(dot.className).not.toContain("bg-green-500");
  });
});
