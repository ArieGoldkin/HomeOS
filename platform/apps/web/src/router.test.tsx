import type { AuthState } from "@shared/auth";
import { ThemeProvider } from "@shared/theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRouter } from "./router";
import { server } from "./test/msw/server";

// #230 — the board screens (TodayScreen, ProfileCard) read the Google session via useCurrentUser; this
// test mounts the router directly (no <AuthProvider>), so mock the auth module's runtime exports. The
// route GUARD still uses the `auth` passed via router context below — this only feeds the screens.
vi.mock("@shared/auth", () => ({
  useCurrentUser: () => ({
    status: "authenticated",
    isLoading: false,
    isAuthenticated: true,
    userId: "u1",
    email: "fam@homeos.test",
    full_name: "משפחה",
    avatar_url: null,
    signOut: async () => {},
  }),
  updateDisplayName: vi.fn().mockResolvedValue(undefined),
  signInWithGoogle: vi.fn(),
}));

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

  // #270 — consent gate
  it("shows the consent screen (board hidden) when the user hasn't accepted the terms", async () => {
    server.use(
      http.get("*/consent", () => HttpResponse.json({ consented: false, version: "2026-07-01" })),
    );
    renderAt("/today", AUTHED);
    await waitFor(() => expect(screen.getByTestId("consent-screen")).toBeInTheDocument());
    expect(screen.queryByText("אסיפת הורים בגן")).not.toBeInTheDocument(); // board gated off
  });

  it("accepting consent reveals the board (POST /consent flips the gate)", async () => {
    server.use(
      http.get("*/consent", () => HttpResponse.json({ consented: false, version: "2026-07-01" })),
    );
    const user = userEvent.setup();
    renderAt("/today", AUTHED);
    await waitFor(() => expect(screen.getByTestId("consent-screen")).toBeInTheDocument());

    await user.click(screen.getByRole("checkbox", { name: /אני מסכים/ }));
    await user.click(screen.getByRole("button", { name: "אני מאשר/ת וממשיך/ה" }));

    // POST /consent (default handler → consented) seeds the cache → the gate renders the board.
    await waitFor(() => expect(screen.getByText("אסיפת הורים בגן")).toBeInTheDocument());
    expect(screen.queryByTestId("consent-screen")).not.toBeInTheDocument();
  });

  it("FAIL-CLOSED: a GET /consent error blocks the board (retry panel, never the board)", async () => {
    server.use(http.get("*/consent", () => new HttpResponse("err", { status: 500 })));
    renderAt("/today", AUTHED);
    await waitFor(() => expect(screen.getByTestId("consent-fallback")).toBeInTheDocument());
    // A never-consented user must NOT slip past the gate during a server blip.
    expect(screen.queryByText("אסיפת הורים בגן")).not.toBeInTheDocument();
  });

  it("renders the standalone Terms and Privacy pages (placeholder legal text)", async () => {
    renderAt("/terms", AUTHED);
    await waitFor(() => expect(screen.getByText("תנאי שימוש")).toBeInTheDocument());
    expect(screen.getByTestId("legal-placeholder")).toBeInTheDocument();

    renderAt("/privacy", AUTHED);
    await waitFor(() => expect(screen.getByText("מדיניות פרטיות")).toBeInTheDocument());
  });
});
