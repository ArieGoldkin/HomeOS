import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { InviteMemberDialog } from "./InviteMemberDialog";

// InviteMemberDialog mints via useCreateInvite (POST /invites, stubbed by the global msw handler), so it
// needs a QueryClientProvider.
function Harness({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        פתח
      </button>
      <InviteMemberDialog open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </>
  );
}

function renderHarness(props: { onCreated?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

describe("InviteMemberDialog (#250)", () => {
  it("opens the email form and closes on cancel", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "פתח" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("כתובת Google")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("mints an invite, fires onCreated, and closes on success", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderHarness({ onCreated });

    await user.click(screen.getByRole("button", { name: "פתח" }));
    await user.type(screen.getByLabelText("כתובת Google"), "savta@example.com");
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("validates a missing email locally (no request, error shown)", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderHarness({ onCreated });

    await user.click(screen.getByRole("button", { name: "פתח" }));
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));

    expect(await screen.findByText("נא להזין כתובת אימייל")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // still open
  });

  it("keeps the dialog open and shows an error when the mint fails (e.g. 403)", async () => {
    const { server } = await import("../../test/msw/server");
    const { HttpResponse, http } = await import("msw");
    server.use(http.post("*/invites", () => new HttpResponse("Forbidden", { status: 403 })));

    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderHarness({ onCreated });

    await user.click(screen.getByRole("button", { name: "פתח" }));
    await user.type(screen.getByLabelText("כתובת Google"), "savta@example.com");
    await user.click(screen.getByRole("button", { name: "שליחת הזמנה" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
