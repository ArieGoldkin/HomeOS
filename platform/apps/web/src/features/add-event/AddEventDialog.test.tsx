import type { ParsedEvent } from "@homeos/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AddEventDialog } from "./AddEventDialog";

// AddEventDialog persists via useCreateEvent (POST /events, stubbed by the global msw handler that
// echoes the body back as a SavedEvent id:999), so it needs a QueryClientProvider.
function Harness({ onCreate }: { onCreate?: (e: ParsedEvent) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        פתח
      </button>
      <AddEventDialog open={open} onOpenChange={setOpen} onCreate={onCreate} />
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

describe("AddEventDialog (the unified responsive Add host)", () => {
  it("opens the form in a dialog and closes on cancel", async () => {
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
    // onCreate gets the validated ParsedEvent (source_text synthesized from the title).
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({ title_he: "ארוחת ערב", kind: "event" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open and shows an error when the create fails", async () => {
    const { server } = await import("../../test/msw/server");
    const { HttpResponse, http } = await import("msw");
    server.use(http.post("*/events", () => new HttpResponse("err", { status: 500 })));

    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderHarness({ onCreate });

    await user.click(screen.getByRole("button", { name: "פתח" }));
    await user.type(screen.getByLabelText("כותרת"), "ארוחת ערב");
    await user.click(screen.getByRole("button", { name: "הוספה" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // still open on failure
    expect(onCreate).not.toHaveBeenCalled();
  });
});
