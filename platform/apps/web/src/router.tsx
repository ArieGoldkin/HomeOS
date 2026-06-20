import { PhoneShell, PhoneToday } from "@app/phone";
import { TabletBoard } from "@app/tablet";
import { WebShell } from "@app/web";
import { ConnectionsView } from "@features/connections";
import { FamilyView } from "@features/family";
import { SettingsView } from "@features/settings";
import { WebWeekView, WeekView } from "@features/week-view";
import { coerceDateIso, ISO_DATE_RE } from "@shared/lib";
import {
  createMemoryHistory,
  createRootRoute,
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
 * `?date=YYYY-MM-DD` for the day/week screens. Optional in/out so navigation (Links/redirects) needn't
 * pass it; a malformed value is dropped. Screens default an absent date to today themselves. Shares the
 * one ISO_DATE_RE shape guard with coerceDateIso (the screen-boundary coercion) — one source of truth.
 */
function validateDateSearch(search: { date?: string }): { date?: string } {
  const raw = search.date;
  return typeof raw === "string" && ISO_DATE_RE.test(raw) ? { date: raw } : {};
}

function RootLayout() {
  useEffect(() => {
    // RTL Hebrew is set in index.html; enforce defensively + set the RTL-aware draw origin that the
    // RuleBar/draw-rule motion reads. (Moved here from App when the router landed.)
    const html = document.documentElement;
    html.setAttribute("dir", "rtl");
    html.setAttribute("lang", "he");
    html.style.setProperty("--draw-origin", "right center");
  }, []);
  return <Outlet />;
}

// getRouteApi reads search by route id from React context, so it works with any router built from the
// tree (prod or a per-test memory router) without holding a module-level route reference.
const todayApi = getRouteApi("/phone/today");
function PhoneTodayScreen() {
  const { date } = todayApi.useSearch();
  return <PhoneToday dateIso={coerceDateIso(date)} />;
}

const weekApi = getRouteApi("/phone/week");
function PhoneWeekScreen() {
  const { date } = weekApi.useSearch();
  const navigate = useNavigate();
  return (
    <WeekView
      dateIso={coerceDateIso(date)}
      onSelectDate={(d) => navigate({ to: "/phone/today", search: { date: d } })}
    />
  );
}

// Web screens reuse the SAME data-connected views as phone (PhoneToday) plus the web-specific WebWeekView
// (7-column grid) and a 2-column FamilyView — surface differences are layout/density only.
const webTodayApi = getRouteApi("/web/today");
function WebTodayScreen() {
  const { date } = webTodayApi.useSearch();
  return <PhoneToday dateIso={coerceDateIso(date)} />;
}

const webWeekApi = getRouteApi("/web/week");
function WebWeekScreen() {
  const { date } = webWeekApi.useSearch();
  const navigate = useNavigate();
  return (
    <WebWeekView
      dateIso={coerceDateIso(date)}
      onSelectDate={(d) => navigate({ to: "/web/today", search: { date: d } })}
    />
  );
}

function WebFamilyScreen() {
  return <FamilyView columns={2} />;
}

/**
 * Build a FRESH route tree. Each router must own its own tree — createRouter mutates the tree it's
 * given, so sharing one across the prod router and per-test routers leaks state between them.
 */
function buildRouteTree() {
  const rootRoute = createRootRoute({ component: RootLayout });

  // `/` stays the ambient kitchen-tablet board — unchanged URL + behavior.
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: TabletBoard,
  });

  const tokensRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tokens",
    component: TokensView,
  });

  // `/phone` is a layout route: PhoneShell chrome (bottom nav) wraps each screen via <Outlet/>.
  const phoneRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/phone",
    component: PhoneShell,
  });

  const phoneIndexRoute = createRoute({
    getParentRoute: () => phoneRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/phone/today" });
    },
  });

  const phoneTodayRoute = createRoute({
    getParentRoute: () => phoneRoute,
    path: "today",
    validateSearch: validateDateSearch,
    component: PhoneTodayScreen,
  });

  const phoneWeekRoute = createRoute({
    getParentRoute: () => phoneRoute,
    path: "week",
    validateSearch: validateDateSearch,
    component: PhoneWeekScreen,
  });

  const phoneFamilyRoute = createRoute({
    getParentRoute: () => phoneRoute,
    path: "family",
    component: FamilyView,
  });

  const phoneSettingsRoute = createRoute({
    getParentRoute: () => phoneRoute,
    path: "settings",
    component: SettingsView,
  });

  // `/web` is a layout route: WebShell chrome (sidebar nav + top-bar Add) wraps each screen via <Outlet/>.
  const webRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/web",
    component: WebShell,
  });

  const webIndexRoute = createRoute({
    getParentRoute: () => webRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/web/today" });
    },
  });

  const webTodayRoute = createRoute({
    getParentRoute: () => webRoute,
    path: "today",
    validateSearch: validateDateSearch,
    component: WebTodayScreen,
  });

  const webWeekRoute = createRoute({
    getParentRoute: () => webRoute,
    path: "week",
    validateSearch: validateDateSearch,
    component: WebWeekScreen,
  });

  const webFamilyRoute = createRoute({
    getParentRoute: () => webRoute,
    path: "family",
    component: WebFamilyScreen,
  });

  const webConnectionsRoute = createRoute({
    getParentRoute: () => webRoute,
    path: "connections",
    component: ConnectionsView,
  });

  const webSettingsRoute = createRoute({
    getParentRoute: () => webRoute,
    path: "settings",
    component: SettingsView,
  });

  return rootRoute.addChildren([
    indexRoute,
    tokensRoute,
    phoneRoute.addChildren([
      phoneIndexRoute,
      phoneTodayRoute,
      phoneWeekRoute,
      phoneFamilyRoute,
      phoneSettingsRoute,
    ]),
    webRoute.addChildren([
      webIndexRoute,
      webTodayRoute,
      webWeekRoute,
      webFamilyRoute,
      webConnectionsRoute,
      webSettingsRoute,
    ]),
  ]);
}

export function createAppRouter(history?: ReturnType<typeof createMemoryHistory>) {
  return createRouter({ routeTree: buildRouteTree(), history });
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
