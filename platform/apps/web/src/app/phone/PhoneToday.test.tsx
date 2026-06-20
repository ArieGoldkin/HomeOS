import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneToday } from "./PhoneToday";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("PhoneToday", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z")); // 12:00 Jerusalem
  });
  afterEach(() => vi.useRealTimers());

  it("renders the selected day's events with a NowLine when that day is today", async () => {
    render(wrap(<PhoneToday dateIso="2026-06-21" />));
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    expect(screen.getByText("now · 12:00")).toBeInTheDocument();
  });

  it("shows no NowLine on a non-today day", async () => {
    render(wrap(<PhoneToday dateIso="2026-06-22" />));
    await waitFor(() => expect(screen.getByText("תור לרופא")).toBeInTheDocument());
    expect(screen.queryByText(/^now ·/)).not.toBeInTheDocument();
  });
});
