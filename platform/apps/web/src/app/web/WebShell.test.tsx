import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createTestRouter } from "../../router";

// WebShell is a layout route with an <Outlet/> + router Links, so it needs a real router context.
// Mount it via the app's test router at a web route (where the sidebar + top-bar Add are assembled).
function renderWeb(path = "/web/today") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createTestRouter(path);
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("WebShell", () => {
  it("renders the sidebar nav and opens the AddEvent modal from the top bar", async () => {
    renderWeb();
    await waitFor(() => expect(screen.getByLabelText("הוספה ללוח")).toBeInTheDocument());

    // Sidebar nav link present (web-only "חיבורים" tab).
    expect(screen.getByRole("link", { name: "חיבורים" })).toBeInTheDocument();

    // Modal starts closed; the top-bar Add opens the centered dialog hosting AddItemForm.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("הוספה ללוח"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספה" })).toBeInTheDocument();
  });

  it("renders the placeholder connections screen at /web/connections", async () => {
    renderWeb("/web/connections");
    await waitFor(() => expect(screen.getByTestId("connections-view")).toBeInTheDocument());
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
  });
});
