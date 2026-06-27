import type { AuthState } from "@shared/auth";
import { ThemeProvider } from "@shared/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRouter } from "./router";

// #225 — the route guard reads auth off the router context. Default the tests to an authenticated session
// (the board is the subject of most cases); the guard cases pass UNAUTH explicitly.
const AUTHED: AuthState = {
  status: "authenticated",
  isLoading: false,
  isAuthenticated: true,
  userId: "u1",
  email: "fam@homeos.test",
  full_name: "משפחה",
  avatar_url: null,
  signOut: async () => {},
};
const UNAUTH: AuthState = {
  status: "unauthenticated",
  isLoading: false,
  isAuthenticated: false,
  userId: null,
  email: null,
  full_name: null,
  avatar_url: null,
  signOut: async () => {},
};

function renderAt(path: string, auth: AuthState = AUTHED) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createTestRouter(path);
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} context={{ auth }} />
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

  // #225 — auth guard
  it("bounces an unauthenticated visit to /today to the login screen", async () => {
    renderAt("/today", UNAUTH);
    await waitFor(() => expect(screen.getByTestId("login-screen")).toBeInTheDocument());
    expect(screen.queryByText("אסיפת הורים בגן")).not.toBeInTheDocument();
  });

  it("bounces an unauthenticated visit to / to the login screen (via /today)", async () => {
    renderAt("/", UNAUTH);
    await waitFor(() => expect(screen.getByTestId("login-screen")).toBeInTheDocument());
  });

  it("renders the login screen at /login for an unauthenticated visitor", async () => {
    renderAt("/login", UNAUTH);
    await waitFor(() => expect(screen.getByTestId("login-screen")).toBeInTheDocument());
  });

  it("sends an authenticated visitor away from /login to the board", async () => {
    renderAt("/login", AUTHED);
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    expect(screen.queryByTestId("login-screen")).not.toBeInTheDocument();
  });
});
