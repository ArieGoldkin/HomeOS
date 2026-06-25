import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { googleConnectedHandler, googleDarkHandler } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { GoogleConnectionCard } from "./GoogleConnectionCard";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("GoogleConnectionCard (#112 — the one real Google card)", () => {
  it("renders the NOT-CONNECTED state with a 'חבר Google' button (default status)", async () => {
    render(wrap(<GoogleConnectionCard />));
    await waitFor(() => expect(screen.getByTestId("google-not-connected")).toBeInTheDocument());
    expect(screen.getByText("לא מחובר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /חבר Google/ })).toBeInTheDocument();
  });

  it("renders the CONNECTED state: green dot, friendly LTR scopes, expiry, נתק", async () => {
    server.use(googleConnectedHandler());
    render(wrap(<GoogleConnectionCard />));
    await waitFor(() => expect(screen.getByTestId("google-connected")).toBeInTheDocument());
    expect(screen.getByText("מחובר")).toBeInTheDocument();
    expect(screen.getByTestId("status-dot")).toBeInTheDocument();
    // friendly scope labels, rendered dir="ltr"
    const scopes = screen.getByTestId("google-scopes");
    expect(scopes).toHaveAttribute("dir", "ltr");
    expect(scopes.textContent).toContain("אירועי יומן");
    expect(screen.getByText(/פג תוקף הגישה/)).toBeInTheDocument();
    expect(screen.getByTestId("disconnect-google-open")).toBeInTheDocument();
  });

  it("renders the DARK/503 state (non-actionable, no Connect button)", async () => {
    server.use(googleDarkHandler());
    render(wrap(<GoogleConnectionCard />));
    await waitFor(() => expect(screen.getByTestId("google-dark")).toBeInTheDocument());
    expect(screen.getByText(/Google לא מוגדר בשרת/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /חבר Google/ })).not.toBeInTheDocument();
  });

  it("renders the ERROR state with a retry that refetches to success", async () => {
    let calls = 0;
    server.use(
      http.get("*/oauth/google/status", () => {
        calls += 1;
        // first call → 500 error; subsequent calls → connected
        if (calls === 1) return new HttpResponse("Server Error", { status: 500 });
        return HttpResponse.json({
          connected: true,
          scopes: ["https://www.googleapis.com/auth/calendar.events"],
          expiresAt: "2026-06-25T18:30:00Z",
        });
      }),
    );
    render(wrap(<GoogleConnectionCard />));
    await waitFor(() => expect(screen.getByTestId("google-error")).toBeInTheDocument());
    expect(screen.getByText("לא ניתן לבדוק את מצב החיבור")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    await waitFor(() => expect(screen.getByTestId("google-connected")).toBeInTheDocument());
  });
});
