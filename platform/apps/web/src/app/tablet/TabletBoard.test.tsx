import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/msw/server";
import { TabletBoard } from "./TabletBoard";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("TabletBoard (live /events, fixed clock)", () => {
  beforeEach(() => {
    // Fake only Date so waitFor's real-timer polling still works; pin to 12:00 Jerusalem on 2026-06-21.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("renders today's timed event with a NowLine + tomorrow's peek from GET /events", async () => {
    render(wrap(<TabletBoard />));
    // today-timed (sample id1: 2026-06-21 18:30)
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    // NowLine injected at the fixed clock (before the 18:30 event)
    expect(screen.getByText("now · 12:00")).toBeInTheDocument();
    // tomorrow peek (sample id2: 2026-06-22)
    expect(screen.getByText("תור לרופא")).toBeInTheDocument();
  });

  it("shows the error state when /events fails", async () => {
    server.use(http.get("*/events", () => new HttpResponse("Unauthorized", { status: 401 })));
    render(wrap(<TabletBoard />));
    await waitFor(() => expect(screen.getByText(/שגיאה/)).toBeInTheDocument());
  });

  // #153 SECURITY LINE (load-bearing): the no-auth kiosk must NEVER expose source_text. TabletBoard
  // renders DayView WITHOUT onOpenDetail, so its event cards stay inert — no button, no way to open the
  // detail drawer that reveals other people's words.
  it("event cards have NO detail affordance — the card is not a button (kiosk exclusion)", async () => {
    render(wrap(<TabletBoard />));
    const card = await screen.findByText("אסיפת הורים בגן");
    // Name-agnostic (F3): the card's text is NOT inside any <button> — independent of accessible-name
    // matching, so it can't false-pass if the label ever changes.
    expect(card.closest("button")).toBeNull();
    // and the original message text is never even in the kiosk DOM.
    expect(screen.queryByText("תזכורת: אסיפת הורים")).toBeNull();
  });
});
