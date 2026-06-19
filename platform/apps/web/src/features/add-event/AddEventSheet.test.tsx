import type { ParsedEvent } from "@homeos/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AddEventSheet } from "./AddEventSheet";

function Harness({ onCreate }: { onCreate?: (e: ParsedEvent) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        פתח
      </button>
      <AddEventSheet open={open} onOpenChange={setOpen} onCreate={onCreate} />
    </>
  );
}

describe("AddEventSheet", () => {
  it("opens the form in a dialog and closes on cancel", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "פתח" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("כותרת")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("calls onCreate and closes on a valid submit", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCreate={onCreate} />);

    await user.click(screen.getByRole("button", { name: "פתח" }));
    await user.type(screen.getByLabelText("כותרת"), "ארוחת ערב");
    await user.click(screen.getByRole("button", { name: "הוספה" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
