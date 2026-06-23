import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TodayScreen } from "./TodayScreen";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("TodayScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T06:00:00Z")); // 09:00 Jerusalem → "בוקר טוב"
  });
  afterEach(() => vi.useRealTimers());

  it("renders the greeting header for the current user", () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    expect(screen.getByText("בוקר טוב,", { exact: false })).toBeInTheDocument();
    // The name renders in the accent span.
    expect(screen.getAllByText("אמא").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the tasks-left chip and the household card", () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    expect(screen.getByText(/משימות היום/)).toBeInTheDocument();
    expect(screen.getByText("משק הבית")).toBeInTheDocument();
    expect(screen.getByText("4 בני בית")).toBeInTheDocument();
  });

  it("renders the data-connected schedule (today's event)", async () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("opens the add-task modal from the action chip", async () => {
    render(wrap(<TodayScreen dateIso="2026-06-21" />));
    fireEvent.click(screen.getByRole("button", { name: "+ משימה חדשה" }));
    // The AddEvent modal mounts a dialog when opened.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});
