import type { ParsedEvent } from "@homeos/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AddEventModal } from "./AddEventModal";

function Harness({ onCreate }: { onCreate?: (e: ParsedEvent) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        פתח
      </button>
      <AddEventModal open={open} onOpenChange={setOpen} onCreate={onCreate} />
    </>
  );
}

function renderHarness(props: { onCreate?: (e: ParsedEvent) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

describe("AddEventModal", () => {
  it("opens the form in a centered dialog and closes on cancel", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "פתח" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("כותרת")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("persists via the create mutation, fires onCreate, and closes on success", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderHarness({ onCreate });

    await user.click(screen.getByRole("button", { name: "פתח" }));
    await user.type(screen.getByLabelText("כותרת"), "ארוחת ערב");
    await user.click(screen.getByRole("button", { name: "הוספה" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ title_he: "ארוחת ערב", kind: "event" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
