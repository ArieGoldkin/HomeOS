import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

// ---------------------------------------------------------------------------
// Minimal controlled harness — mirrors real usage where parent owns open state
// ---------------------------------------------------------------------------

interface HarnessProps {
  onOpenChange?: (open: boolean) => void;
}

function Harness({ onOpenChange }: HarnessProps) {
  const [open, setOpen] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  return (
    <>
      <button type="button" onClick={() => handleOpenChange(true)}>
        פתח גיליון
      </button>
      <Sheet open={open} onOpenChange={handleOpenChange} title="הגדרות">
        <p>תוכן פנימי</p>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sheet", () => {
  it("1. opens and displays the title and children after clicking the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Dialog should not be in the DOM yet
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "פתח גיליון" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("הגדרות")).toBeInTheDocument();
    expect(screen.getByText("תוכן פנימי")).toBeInTheDocument();
  });

  it("2. ESC key closes the sheet and calls onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onOpenChange={spy} />);

    // Open the sheet first
    await user.click(screen.getByRole("button", { name: "פתח גיליון" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press Escape — Radix Dialog handles this natively
    await user.keyboard("{Escape}");

    // The dialog element should be removed from the DOM
    expect(screen.queryByRole("dialog")).toBeNull();
    // And the spy should have been called with false (the close signal)
    expect(spy).toHaveBeenCalledWith(false);
  });

  it("3. focus moves inside the dialog after opening (focus trap)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "פתח גיליון" }));

    const dialog = screen.getByRole("dialog");

    // Radix moves focus into the dialog content; give it a tick to settle
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("4. dialog has an accessible name equal to the title prop", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "פתח גיליון" }));

    // Radix wires Dialog.Title → aria-labelledby on the dialog element
    const dialog = screen.getByRole("dialog", { name: "הגדרות" });
    expect(dialog).toBeInTheDocument();
  });

  it("close button (×) is labelled 'סגירה' and closes the sheet", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "פתח גיליון" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // The × button inside the sheet carries aria-label="סגירה"
    const closeBtn = screen.getByRole("button", { name: "סגירה" });
    await user.click(closeBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
