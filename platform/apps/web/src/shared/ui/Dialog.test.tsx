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
