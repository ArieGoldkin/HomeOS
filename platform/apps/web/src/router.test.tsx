import { ThemeProvider } from "@shared/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRouter } from "./router";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createTestRouter(path);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe("router (one responsive app)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-21T09:00:00Z")); // 12:00 Jerusalem
  });
  afterEach(() => vi.useRealTimers());

  it("redirects / to /today (the old root is gone)", async () => {
    renderAt("/");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("renders Today inside the AppShell at /today", async () => {
    renderAt("/today");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    // The shell chrome is present: the render-only command-bar placeholder.
    expect(screen.getByText("איך אפשר לעזור היום?")).toBeInTheDocument();
  });

  it("renders both nav surfaces (desktop rail + mobile bar) with the flat items", async () => {
    renderAt("/today");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    // Rail + bottom bar both render (CSS-toggled), so each item resolves to two links by accessible name.
    expect(screen.getAllByRole("navigation", { name: "ניווט ראשי" })).toHaveLength(2);
    for (const label of ["היום", "יומן", "אנשים", "רשימות", "חיבורים", "הגדרות"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("falls back to today when ?date= is malformed", async () => {
    renderAt("/today?date=not-a-date");
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
  });

  it("honors a valid ?date= and shows that day, not today", async () => {
    // Clock is 2026-06-21. The sample reminder "תור לרופא" is on 2026-06-22; today's event
    // "אסיפת הורים בגן" (the 21st) must NOT render — proving the valid date is honored.
    renderAt("/today?date=2026-06-22");
    await waitFor(() => expect(screen.getByText("תור לרופא")).toBeInTheDocument());
    expect(screen.queryByText("אסיפת הורים בגן")).not.toBeInTheDocument();
  });

  it("resolves the deferred Lists route to a placeholder", async () => {
    renderAt("/lists");
    await waitFor(() => expect(screen.getByText("בקרוב")).toBeInTheDocument());
  });
});
