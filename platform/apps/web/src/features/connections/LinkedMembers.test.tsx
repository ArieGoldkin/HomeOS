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

describe("LinkedMembers (#231 — real verified members from GET /family)", () => {
  it("renders ONLY verified members, not the unverified ones or a hardcoded list", async () => {
    // default sampleFamily: אבא + אמא verified, יואב + נועה not.
    render(wrap(<LinkedMembers />));
    await waitFor(() => expect(screen.getByText("אבא")).toBeInTheDocument());
    expect(screen.getByText("אמא")).toBeInTheDocument();
    expect(screen.queryByText("יואב")).not.toBeInTheDocument(); // unverified → hidden
    expect(screen.queryByText("נועה")).not.toBeInTheDocument(); // unverified → hidden
  });

  it("shows the count of verified members (not the full roster)", async () => {
    render(wrap(<LinkedMembers />));
    await waitFor(() => expect(screen.getByText(/2 מעבירים ללוח/)).toBeInTheDocument());
  });

  it("shows an empty-state message when no member is verified", async () => {
    server.use(
      http.get("*/family", () =>
        HttpResponse.json({
          family: { display_name: "משפחה" },
          members: [
            { name: "אבא", role: "owner", verified: false },
            { name: "אמא", role: "member", verified: false },
          ],
        }),
      ),
    );
    render(wrap(<LinkedMembers />));
    await waitFor(() => expect(screen.getByText(/אין בני בית מאומתים/)).toBeInTheDocument());
    expect(screen.queryByText("אבא")).not.toBeInTheDocument();
  });

  it("shows an error message when the roster request fails", async () => {
    server.use(http.get("*/family", () => new HttpResponse("Unauthorized", { status: 401 })));
    render(wrap(<LinkedMembers />));
    await waitFor(() => expect(screen.getByText(/שגיאה בטעינת בני הבית/)).toBeInTheDocument());
  });

  it("keeps the linked-members card testid (ConnectionsView composition)", async () => {
    render(wrap(<LinkedMembers />));
    expect(screen.getByTestId("linked-members")).toBeInTheDocument();
  });
});
