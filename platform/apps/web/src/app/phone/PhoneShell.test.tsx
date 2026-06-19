import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createTestRouter } from "../../router";

// PhoneShell renders an <Outlet/> + router Links, so it needs a real router context. Mount it via the
// app's test router at a phone route — the only place the FAB → AddEventSheet wiring is assembled.
function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createTestRouter("/phone/today");
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("PhoneShell", () => {
  it("opens the AddEvent sheet when the FAB is clicked", async () => {
    renderShell();
    await waitFor(() => expect(screen.getByLabelText("הוספה ללוח")).toBeInTheDocument());

    // Sheet starts closed.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("הוספה ללוח"));

    // The Radix dialog opens and hosts the AddItemForm (its submit button proves the form mounted).
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
  });
});
