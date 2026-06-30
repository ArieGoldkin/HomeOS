import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { sampleInvites } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { InviteMembers } from "./InviteMembers";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<InviteMembers />, { wrapper: Wrapper });
}

describe("InviteMembers (#250 — owner-gated invite admin card)", () => {
  it("renders the card with the owner's pending invites (success)", async () => {
    renderCard();
    expect(await screen.findByTestId("invite-members")).toBeInTheDocument();
    expect(screen.getByText("savta@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הזמינו" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no pending invites", async () => {
    server.use(http.get("*/invites", () => HttpResponse.json({ invites: [] })));
    renderCard();
    expect(await screen.findByText("אין הזמנות ממתינות.")).toBeInTheDocument();
  });

  it("renders NOTHING when the query 403s (a non-owner — the capability gate)", async () => {
    server.use(http.get("*/invites", () => new HttpResponse("Forbidden", { status: 403 })));
    renderCard();
    // Give the (non-retrying) query a tick to settle into error, then assert the card never appeared.
    await waitFor(() => expect(screen.queryByTestId("invite-members")).not.toBeInTheDocument());
  });

  it("shows an error notice (NOT hidden) on a non-403 failure — a real owner's transient blip", async () => {
    server.use(http.get("*/invites", () => new HttpResponse("Server Error", { status: 500 })));
    renderCard();
    // A 500 is not the owner gate: the card renders with an error notice instead of vanishing.
    expect(await screen.findByTestId("invite-members")).toBeInTheDocument();
    expect(screen.getByText("שגיאה בטעינת ההזמנות — ננסה שוב בקרוב.")).toBeInTheDocument();
  });

  it("revokes a pending invite (DELETE by invite_id) when its revoke button is clicked", async () => {
    let revokedId: string | undefined;
    server.use(
      http.delete("*/invites/:id", ({ params }) => {
        revokedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("savta@example.com");
    // The revoke button is per-invite labelled (a11y — distinct from the dialog's "ביטול" cancel).
    await user.click(screen.getByRole("button", { name: "ביטול הזמנה ל-savta@example.com" }));

    await waitFor(() => expect(revokedId).toBe(sampleInvites[0]?.invite_id));
  });
});
