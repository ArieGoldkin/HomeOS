import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRouter } from "./router";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createTestRouter(path);
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("router", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z")); // 12:00 Jerusalem
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the ambient tablet board at /", async () => {
    renderAt("/");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("renders the phone today screen with the four nav tabs at /phone/today", async () => {
    renderAt("/phone/today");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());

    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    for (const label of ["היום", "שבוע", "משפחה", "הגדרות"]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it("redirects /phone to /phone/today", async () => {
    renderAt("/phone");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("falls back to today when ?date= is malformed", async () => {
    renderAt("/phone/today?date=not-a-date");
    // validateSearch replaced the bad value with today → today's event still renders.
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("honors a valid ?date= and shows that day, not today", async () => {
    // Clock is 2026-06-21 (today). The sample reminder "תור לרופא" is on 2026-06-22; today's event
    // "אסיפת הורים בגן" (the 21st) must NOT be the rendered day — proving the valid date is honored.
    renderAt("/phone/today?date=2026-06-22");
    await waitFor(() => expect(screen.getByText("תור לרופא")).toBeInTheDocument());
    expect(screen.queryByText("אסיפת הורים בגן")).not.toBeInTheDocument();
  });
});
