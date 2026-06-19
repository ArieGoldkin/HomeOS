import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label text", () => {
    render(<Button>שמור</Button>);
    expect(screen.getByRole("button", { name: "שמור" })).toBeInTheDocument();
  });

  it("defaults to type=button so it does not submit forms accidentally", () => {
    render(<Button>שלח</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("variant=dashed applies a dashed border class", () => {
    render(<Button variant="dashed">הוסף</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/border-dashed/);
  });

  it("variant=primary is the default and includes bg-primary", () => {
    render(<Button>ברירת מחדל</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toMatch(/bg-primary/);
  });

  it("variant=ghost has no bg-primary", () => {
    render(<Button variant="ghost">ביטול</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).not.toMatch(/bg-primary/);
  });

  it("fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>לחץ</Button>);
    await user.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        נעול
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("merges additional className", () => {
    render(<Button className="my-custom-class">עוד</Button>);
    expect(screen.getByRole("button").className).toContain("my-custom-class");
  });
});
