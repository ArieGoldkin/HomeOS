import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("is findable by its aria-label", () => {
    render(<IconButton aria-label="סגור">✕</IconButton>);
    expect(screen.getByRole("button", { name: "סגור" })).toBeInTheDocument();
  });

  it("renders its children (the icon glyph)", () => {
    render(<IconButton aria-label="הוסף">+</IconButton>);
    expect(screen.getByRole("button").textContent).toBe("+");
  });

  it("defaults to type=button", () => {
    render(<IconButton aria-label="מחק">×</IconButton>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <IconButton aria-label="פעולה" onClick={handleClick}>
        ★
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "פעולה" }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <IconButton aria-label="נעול" disabled onClick={handleClick}>
        🔒
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "נעול" }));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("variant=primary applies bg-primary class", () => {
    render(
      <IconButton aria-label="ראשי" variant="primary">
        ▶
      </IconButton>,
    );
    expect(screen.getByRole("button").className).toMatch(/bg-primary/);
  });

  it("variant=ghost (default) has no bg-primary", () => {
    render(<IconButton aria-label="רקע">☰</IconButton>);
    expect(screen.getByRole("button").className).not.toMatch(/bg-primary/);
  });

  it("is 44px (size-11) — minimum touch target", () => {
    render(<IconButton aria-label="מגע">⊕</IconButton>);
    expect(screen.getByRole("button").className).toMatch(/size-11/);
  });

  it("is rounded-full", () => {
    render(<IconButton aria-label="עיגול">○</IconButton>);
    expect(screen.getByRole("button").className).toMatch(/rounded-full/);
  });
});
