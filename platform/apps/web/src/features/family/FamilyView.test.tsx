import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { FamilyView } from "./FamilyView";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("FamilyView (data-connected)", () => {
  it("renders the known family roster", async () => {
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText("אבא")).toBeInTheDocument());
    expect(screen.getByText("אמא")).toBeInTheDocument();
    expect(screen.getByText("יואב")).toBeInTheDocument();
    expect(screen.getByText("נועה")).toBeInTheDocument();
  });

  it("derives a new assignee from events into the roster", async () => {
    server.use(
      http.get("*/events", () =>
        HttpResponse.json({
          events: [
            {
              id: 5,
              kind: "task",
              title_he: "מטלה",
              date_iso: "2026-06-21",
              time: null,
              location: null,
              assignee: "סבתא",
              recurrence: null,
              source_text: "x",
              source_provider: null,
            },
          ],
        }),
      ),
    );
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText("סבתא")).toBeInTheDocument());
    // known roster still present alongside the derived name
    expect(screen.getByText("אבא")).toBeInTheDocument();
  });

  it("shows the add-member button", async () => {
    render(wrap(<FamilyView />));
    await waitFor(() => expect(screen.getByText("הוספת בן משפחה")).toBeInTheDocument());
  });
});
