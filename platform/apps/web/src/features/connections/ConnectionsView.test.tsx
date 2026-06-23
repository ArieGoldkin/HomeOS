import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ConnectionsView } from "./ConnectionsView";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("ConnectionsView (merged channel + how-it-works + feed + members + services)", () => {
  it("renders the heading and the WhatsApp channel hero with a connected status", () => {
    render(wrap(<ConnectionsView />));
    expect(screen.getByText("מרכז")).toBeInTheDocument();
    expect(screen.getByText("החיבורים")).toBeInTheDocument();
    expect(screen.getByTestId("wa-channel")).toBeInTheDocument();
    expect(screen.getByText("מחובר")).toBeInTheDocument();
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

  it("shows linked members and the connected-service tiles", () => {
    render(wrap(<ConnectionsView />));
    expect(screen.getByTestId("linked-members")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "בקרוב" })).toHaveLength(2);
  });
});
