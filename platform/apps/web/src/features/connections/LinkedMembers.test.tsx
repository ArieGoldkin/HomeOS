import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { LinkedMembers } from "./LinkedMembers";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("LinkedMembers (#266 — family-level WhatsApp connection status)", () => {
  it("shows the connected state when the family has a bound number (whatsappConnected true)", async () => {
    // default sampleFamily: whatsappConnected = true
    render(wrap(<LinkedMembers />));
    await waitFor(() => expect(screen.getByText(/WhatsApp מחובר/)).toBeInTheDocument());
  });

  it("shows the not-connected empty state when whatsappConnected is false", async () => {
    server.use(
      http.get("*/family", () =>
        HttpResponse.json({
          family: { display_name: "משפחה", whatsappConnected: false },
          members: [{ name: "אבא", role: "owner" }],
        }),
      ),
    );
    render(wrap(<LinkedMembers />));
    await waitFor(() =>
      expect(screen.getByText(/אין עדיין מספר WhatsApp מחובר/)).toBeInTheDocument(),
    );
  });

  it("shows an error message when the roster request fails", async () => {
    server.use(http.get("*/family", () => new HttpResponse("Unauthorized", { status: 401 })));
    render(wrap(<LinkedMembers />));
    await waitFor(() => expect(screen.getByText(/שגיאה בטעינת מצב החיבור/)).toBeInTheDocument());
  });

  it("keeps the linked-members card testid (ConnectionsView composition)", async () => {
    render(wrap(<LinkedMembers />));
    expect(screen.getByTestId("linked-members")).toBeInTheDocument();
  });
});
