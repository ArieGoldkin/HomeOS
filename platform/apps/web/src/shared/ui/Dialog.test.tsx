import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog (the unified responsive host)", () => {
  it("renders the title and body when open", () => {
    render(
      <Dialog open onOpenChange={() => {}} title="הוספה ללוח">
        <p>תוכן</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("הוספה ללוח")).toBeInTheDocument();
    expect(screen.getByText("תוכן")).toBeInTheDocument();
  });

  // #205 — the content panel must use the OPAQUE focused-overlay surface (--popover), not the
  // ambient-card token (--card), which is translucent-by-design in dark mode (for glass board cards) and
  // let the page bleed through the dialog. jsdom can't resolve CSS vars, so we pin the surface class.
  it("uses the opaque popover surface, not the translucent card token", () => {
    render(
      <Dialog open onOpenChange={() => {}} title="הוספה ללוח">
        <p>תוכן</p>
      </Dialog>,
    );
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("bg-popover");
    expect(panel).not.toHaveClass("bg-card");
  });

  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onOpenChange={() => {}} title="הוספה ללוח">
        <p>תוכן</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("requests close (onOpenChange false) when the close button is activated", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="הוספה ללוח">
        <p>תוכן</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
