import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { RecentIngestion } from "./RecentIngestion";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("RecentIngestion (data-connected feed, distinct messages token)", () => {
  it("renders each inbound message with its raw text and a converged StatusPill outcome", async () => {
    render(wrap(<RecentIngestion />));
    // the parsed forward — raw text + a "נוסף ליומן" pill (now a StatusPill)
    await waitFor(() => expect(screen.getByText("אסיפת הורים מחר ב-18:30")).toBeInTheDocument());
    expect(screen.getByText("נוסף ליומן")).toBeInTheDocument();
    // the outcome pills converged onto the shared primitive
    expect(screen.getAllByTestId("outcome-pill").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("message-row")).toHaveLength(2);
  });

  it("shows a media placeholder + outcome for a non-text message (null text)", async () => {
    render(wrap(<RecentIngestion />));
    await waitFor(() => expect(screen.getByText("🎤 הודעה קולית")).toBeInTheDocument());
    expect(screen.getByText("לא טקסט")).toBeInTheDocument();
  });

  it("shows an empty state when there are no messages", async () => {
    server.use(http.get("*/messages", () => HttpResponse.json({ messages: [] })));
    render(wrap(<RecentIngestion />));
    await waitFor(() => expect(screen.getByText(/עדיין אין הודעות/)).toBeInTheDocument());
  });

  it("shows an error state on a 401 (distinct token missing/invalid)", async () => {
    server.use(http.get("*/messages", () => new HttpResponse("Unauthorized", { status: 401 })));
    render(wrap(<RecentIngestion />));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
