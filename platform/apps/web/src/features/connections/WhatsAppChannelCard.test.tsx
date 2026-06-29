import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { WhatsAppChannelCard } from "./WhatsAppChannelCard";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("WhatsAppChannelCard (#231 — real bot number from GET /channel)", () => {
  it("renders the bot number from the server, not a hardcoded constant", async () => {
    render(wrap(<WhatsAppChannelCard />));
    await waitFor(() =>
      expect(screen.getByTestId("wa-bot-number")).toHaveTextContent("+972 50-123 4567"),
    );
    // the retired placeholder constant must not appear
    expect(screen.queryByText("+972 50-000-0000")).not.toBeInTheDocument();
    // the channel stays presented as live
    expect(screen.getByText("מחובר")).toBeInTheDocument();
  });

  it("shows a neutral '—' fallback when the server has no number configured (botPhone: null)", async () => {
    server.use(http.get("*/channel", () => HttpResponse.json({ botPhone: null })));
    render(wrap(<WhatsAppChannelCard />));
    await waitFor(() => expect(screen.getByTestId("wa-bot-number")).toHaveTextContent("—"));
  });

  it("shows the '—' fallback when the channel read fails (no fake number)", async () => {
    server.use(http.get("*/channel", () => new HttpResponse("Server Error", { status: 500 })));
    render(wrap(<WhatsAppChannelCard />));
    await waitFor(() => expect(screen.getByTestId("wa-bot-number")).toHaveTextContent("—"));
  });

  it("renders the bot number dir=ltr inside the RTL layout", async () => {
    render(wrap(<WhatsAppChannelCard />));
    await waitFor(() => expect(screen.getByTestId("wa-bot-number")).toHaveAttribute("dir", "ltr"));
  });
});
