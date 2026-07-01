import { useConsent } from "@shared/hooks";
import { AppShell } from "./AppShell";
import { ConsentScreen } from "./ConsentScreen";

/**
 * #270 — the consent gate wrapping the authenticated app (it is the `app` route's component, so it renders
 * for authed users only — the route's beforeLoad already bounced the unauthenticated to /login). It shows
 * the {@link ConsentScreen} to a user who has NOT accepted the current Terms/Privacy, otherwise the normal
 * {@link AppShell} (which hosts the screens via its Outlet).
 *
 * FAIL-OPEN: only a DEFINITIVE `consented === false` shows the screen. While the consent query is loading,
 * on an error, or when consented, the shell renders — so a transient `GET /consent` failure never locks the
 * family out of their board (the server isn't a hard gate here by design; the durable record is `POST
 * /consent`). The `useConsent` query has `staleTime: Infinity`, so after the first resolve there's no flash.
 */
export function ConsentGate() {
  const { data } = useConsent();
  if (data?.consented === false) return <ConsentScreen />;
  return <AppShell />;
}
