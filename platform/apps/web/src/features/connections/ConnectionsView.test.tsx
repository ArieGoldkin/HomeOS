import { ThemeProvider } from "@shared/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createTestRouter } from "../../router";
import { ConnectionsView } from "./ConnectionsView";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

/** Render the full app at a path (the router wires the typed ?status= param → banner). */
function renderAppAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createTestRouter(path);
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("ConnectionsView (merged channel + how-it-works + feed + members + Google)", () => {
  it("renders the heading and the WhatsApp channel hero with a connected status", () => {
    render(wrap(<ConnectionsView />));
    expect(screen.getByText("מרכז")).toBeInTheDocument();
    expect(screen.getByText("החיבורים")).toBeInTheDocument();
    const hero = screen.getByTestId("wa-channel");
    expect(within(hero).getByText("מחובר")).toBeInTheDocument();
  });

  it("keeps the forward-only privacy footnote (the red line)", () => {
    render(wrap(<ConnectionsView />));
    expect(screen.getByTestId("privacy-footnote")).toBeInTheDocument();
  });

  it("folds in the recent-ingestion feed with converged outcome pills", async () => {
    render(wrap(<ConnectionsView />));
    // the message text (distinct 18:30, vs the 17:00 demo bubble) + its converged StatusPill outcome
    await waitFor(() => expect(screen.getByText("אסיפת הורים מחר ב-18:30")).toBeInTheDocument());
    expect(screen.getByText("נוסף ליומן")).toBeInTheDocument();
  });

  it("shows linked members and the single real Google connection card (no static tiles)", async () => {
    render(wrap(<ConnectionsView />));
    expect(screen.getByTestId("linked-members")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("google-connection-card")).toBeInTheDocument());
    // the old static "בקרוב" Google Calendar + Gmail tiles are gone
    expect(screen.queryByRole("button", { name: "בקרוב" })).not.toBeInTheDocument();
    expect(screen.queryByText("Google Calendar")).not.toBeInTheDocument();
  });

  it("renders a success banner from the connectStatus prop", () => {
    render(wrap(<ConnectionsView connectStatus="connected" onDismissStatus={() => {}} />));
    expect(screen.getByTestId("connect-status-banner")).toHaveTextContent(
      "החשבון של Google חובר בהצלחה",
    );
  });

  it("renders an error banner for a non-success outcome (mapped, never the raw param)", () => {
    render(wrap(<ConnectionsView connectStatus="bad_account" onDismissStatus={() => {}} />));
    const banner = screen.getByTestId("connect-status-banner");
    expect(banner).toHaveTextContent("חשבון Google לא מורשה — השתמשו בחשבון המשפחה");
    expect(banner.textContent).not.toContain("bad_account");
  });

  it("calls onDismissStatus once after the banner is shown", () => {
    const onDismiss = vi.fn();
    render(wrap(<ConnectionsView connectStatus="connected" onDismissStatus={onDismiss} />));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectionsView banner via the router (?status=)", () => {
  it("?status=connected shows the success banner then strips the param", async () => {
    const router = renderAppAt("/connections?status=connected");
    await waitFor(() =>
      expect(screen.getByTestId("connect-status-banner")).toHaveTextContent(
        "החשבון של Google חובר בהצלחה",
      ),
    );
    // the param is stripped from the URL after the banner is shown
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("status"));
  });

  it("?status=bad_account shows the error copy", async () => {
    renderAppAt("/connections?status=bad_account");
    await waitFor(() =>
      expect(screen.getByTestId("connect-status-banner")).toHaveTextContent(
        "חשבון Google לא מורשה — השתמשו בחשבון המשפחה",
      ),
    );
  });

  it("drops an unknown ?status= value (allowlist), showing no banner", async () => {
    renderAppAt("/connections?status=not-a-real-outcome");
    await waitFor(() => expect(screen.getByTestId("connections-view")).toBeInTheDocument());
    expect(screen.queryByTestId("connect-status-banner")).not.toBeInTheDocument();
  });
});
