import { ConsentGate, LegalPage, ListsPlaceholder } from "@app/shell";
import { LoginScreen } from "@features/auth";
import { ConnectionsView } from "@features/connections";
import { TodayScreen } from "@features/day-view";
import { FamilyView } from "@features/family";
import { Onboarding } from "@features/onboarding";
import { SettingsView } from "@features/settings";
import { CalendarScreen } from "@features/week-view";
import { type ConnectOutcome, connectOutcomeSchema } from "@homeos/shared";
import type { AuthState } from "@shared/auth";
import { coerceDateIso, ISO_DATE_RE } from "@shared/lib";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  getRouteApi,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { TokensView } from "./dev/TokensView";

/**
 * `?date=YYYY-MM-DD` for the today/calendar screens. Optional in/out so navigation (Links/redirects)
 * needn't pass it; a malformed value is dropped. Screens default an absent date to today. Shares the one
 * ISO_DATE_RE shape guard with coerceDateIso (the screen-boundary coercion) — one source of truth.
 */
function validateDateSearch(search: { date?: string }): { date?: string } {
  const raw = search.date;
  return typeof raw === "string" && ISO_DATE_RE.test(raw) ? { date: raw } : {};
}

/**
 * #112 — the OAuth callback bounces the family browser back to `/connections?status=<outcome>`. We validate
 * the param against the shared `connectOutcomeSchema` (the SAME enum the server can emit) and DROP anything
 * outside it — so the screen only ever maps an allowlisted enum value, never a raw/attacker-chosen param.
 */
function validateConnectionsSearch(search: { status?: string }): { status?: ConnectOutcome } {
  const parsed = connectOutcomeSchema.safeParse(search.status);
  return parsed.success ? { status: parsed.data } : {};
}

function RootLayout() {
  useEffect(() => {
    // RTL Hebrew is set in index.html; enforce defensively + set the RTL-aware draw origin that the
    // RuleBar/draw-rule motion reads. (Theme — data-theme — is owned by the ThemeProvider, #172.)
    const html = document.documentElement;
    html.setAttribute("dir", "rtl");
    html.setAttribute("lang", "he");
    html.style.setProperty("--draw-origin", "right center");
  }, []);
  return <Outlet />;
}

// getRouteApi reads search by route id from React context, so it works with any router built from the
// tree (prod or a per-test memory router) without holding a module-level route reference.
// Thin route wrapper: read the validated ?date= and hand it to the Today screen composition.
const todayApi = getRouteApi("/app/today");
function TodayRoute() {
  const { date } = todayApi.useSearch();
  return <TodayScreen dateIso={coerceDateIso(date)} />;
}

const calendarApi = getRouteApi("/app/calendar");
function CalendarRoute() {
  const { date } = calendarApi.useSearch();
  const navigate = useNavigate();
  return (
    <CalendarScreen
      dateIso={coerceDateIso(date)}
      onSelectDate={(d) => navigate({ to: "/today", search: { date: d } })}
      onChangeWeek={(anchor) => navigate({ to: "/calendar", search: { date: anchor } })}
    />
  );
}

// #112 — read the validated ?status= outcome and hand it to the Connections screen, with a callback that
// strips the param from the URL once the banner has been shown (replace, so Back doesn't re-show it).
const connectionsApi = getRouteApi("/app/connections");
function ConnectionsRoute() {
  const { status } = connectionsApi.useSearch();
  const navigate = useNavigate();
  return (
    <ConnectionsView
      connectStatus={status}
      onDismissStatus={() =>
        navigate({ to: "/connections", search: { status: undefined }, replace: true })
      }
    />
  );
}

// First-run onboarding (standalone, no shell chrome). onDone enters the board at /today; the connect/
// invite steps route to the real Connections screen (no fake QR/roster — gap #3 de-fang).
function WelcomeScreen() {
  const navigate = useNavigate();
  return (
    <Onboarding
      onDone={() => navigate({ to: "/today" })}
      onGoToConnections={() => navigate({ to: "/connections", search: { status: undefined } })}
    />
  );
}

// The People screen (roster). Its "+ הזמנת בן בית" affordance routes to the real Connections invite surface
// (the owner-only InviteMembers card) — previously the button had no handler and did nothing.
function PeopleScreen() {
  const navigate = useNavigate();
  return (
    <FamilyView
      onAddMember={() => navigate({ to: "/connections", search: { status: undefined } })}
    />
  );
}

/**
 * #225 — the router carries the live Supabase auth state in its context (App.tsx feeds it in from
 * `useCurrentUser`). The default is UNAUTHENTICATED so a router that's never given context fails safe to
 * the login screen rather than leaking the board.
 */
export interface RouterContext {
  auth: AuthState;
}

const UNAUTHENTICATED_CONTEXT: RouterContext = {
  auth: {
    status: "unauthenticated",
    isLoading: false,
    isAuthenticated: false,
    userId: null,
    email: null,
    full_name: null,
    avatar_url: null,
    signOut: async () => {},
  },
};

/**
 * Build a FRESH route tree. Each router must own its own tree — createRouter mutates the tree it's
 * given, so sharing one across the prod router and per-test routers leaks state between them.
 *
 * ONE responsive app: a pathless layout route (AppShell chrome) hosts the flat screens; `/` redirects
 * to `/today`. The old `/`, `/phone/*`, and `/web/*` route trees are gone.
 */
function buildRouteTree() {
  const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/today" });
    },
  });

  // The app shell (icon rail + header) wraps every screen via <Outlet/>. Pathless so children own the
  // flat top-level paths. #225 — guard every authed screen here in one place: an unauthenticated visit
  // bounces to /login (the Google OAuth round-trip returns the user to /today with a cookie session).
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    beforeLoad: ({ context }) => {
      if (!context.auth.isAuthenticated) {
        throw redirect({ to: "/login" });
      }
    },
    // #270 — ConsentGate wraps the shell: an authed user who hasn't accepted the current Terms/Privacy sees
    // the consent screen instead of the board (it renders AppShell once consented / on fail-open).
    component: ConsentGate,
  });

  const todayRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/today",
    validateSearch: validateDateSearch,
    component: TodayRoute,
  });

  const calendarRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/calendar",
    validateSearch: validateDateSearch,
    component: CalendarRoute,
  });

  const peopleRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/people",
    component: PeopleScreen,
  });

  const connectionsRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/connections",
    validateSearch: validateConnectionsSearch,
    component: ConnectionsRoute,
  });

  const settingsRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/settings",
    component: SettingsView,
  });

  // Lists is a deferred net-new surface — a routed placeholder so the rail item isn't a dead link.
  const listsRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/lists",
    component: ListsPlaceholder,
  });

  // #225 — the standalone login screen (no shell chrome). An already-authenticated visit (e.g. landing
  // back here after the OAuth return) skips straight to the board.
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    beforeLoad: ({ context }) => {
      if (context.auth.isAuthenticated) {
        throw redirect({ to: "/today" });
      }
    },
    component: LoginScreen,
  });

  // Standalone routes (no shell chrome): first-run onboarding + the dev token gallery.
  const welcomeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/welcome",
    component: WelcomeScreen,
  });

  const tokensRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tokens",
    component: TokensView,
  });

  // #270 — standalone Terms / Privacy pages (no shell chrome), linked from the consent screen.
  const termsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/terms",
    component: () => <LegalPage kind="terms" />,
  });

  const privacyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: () => <LegalPage kind="privacy" />,
  });

  return rootRoute.addChildren([
    indexRoute,
    appRoute.addChildren([
      todayRoute,
      calendarRoute,
      peopleRoute,
      connectionsRoute,
      settingsRoute,
      listsRoute,
    ]),
    loginRoute,
    welcomeRoute,
    tokensRoute,
    termsRoute,
    privacyRoute,
  ]);
}

export function createAppRouter(history?: ReturnType<typeof createMemoryHistory>) {
  return createRouter({
    routeTree: buildRouteTree(),
    history,
    // App.tsx overrides this with the live auth state via RouterProvider's `context` prop.
    context: UNAUTHENTICATED_CONTEXT,
  });
}

export const router = createAppRouter();

/** An isolated router over a fresh tree at `path` — used by tests (memory history). */
export function createTestRouter(path: string) {
  return createAppRouter(createMemoryHistory({ initialEntries: [path] }));
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
