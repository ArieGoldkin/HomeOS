import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { DisconnectGoogleButton } from "./DisconnectGoogleButton";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

// #231 — disconnect is now SESSION-gated (the Supabase cookie rides the request), so the confirm dialog
// has NO setup-code field; on confirm it calls disconnectGoogle() (default msw handler → 204).
describe("DisconnectGoogleButton (#231 — session-gated confirm-before-destroy)", () => {
  it("opens a confirm dialog with no setup-code field and disconnects on confirm", async () => {
    render(wrap(<DisconnectGoogleButton />));
    await userEvent.click(screen.getByTestId("disconnect-google-open"));
    const confirm = await screen.findByRole("button", { name: "נתק את החשבון" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); // no code input (cookie-gated)
    await userEvent.click(confirm);
    // dialog closes on a successful disconnect
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "נתק את החשבון" })).not.toBeInTheDocument(),
    );
  });

  it("maps a 401 to allowlisted inline Hebrew and keeps the dialog open", async () => {
    server.use(
      http.post(
        "*/oauth/google/disconnect",
        () => new HttpResponse("Unauthorized", { status: 401 }),
      ),
    );
    render(wrap(<DisconnectGoogleButton />));
    await userEvent.click(screen.getByTestId("disconnect-google-open"));
    await userEvent.click(await screen.findByRole("button", { name: "נתק את החשבון" }));
    const alert = await screen.findByTestId("disconnect-google-error");
    expect(alert).toHaveTextContent("ההתחברות פגה, התחברו מחדש"); // reason "auth" → Hebrew
  });
});
