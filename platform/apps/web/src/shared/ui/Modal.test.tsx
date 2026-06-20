import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Modal } from "./Modal";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        פתח
      </button>
      <Modal open={open} onOpenChange={setOpen} title="הוספה ללוח">
        <p>תוכן הדיאלוג</p>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("opens as a named dialog and closes via the close button", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "פתח" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("הוספה ללוח");
    expect(screen.getByText("תוכן הדיאלוג")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
