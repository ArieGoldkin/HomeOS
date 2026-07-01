import { useConsent } from "@shared/hooks";
import { Button } from "@shared/ui";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { ConsentScreen } from "./ConsentScreen";

/** A minimal full-screen paper panel — the gate's loading/error states never reveal the board. */
function ConsentFallback({ children }: { children: ReactNode }) {
  return (
    <div
      className="paper-grain flex min-h-dvh items-center justify-center p-6 text-center"
      data-testid="consent-fallback"
    >
      <div className="max-w-sm text-[15px] text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * #270 — the consent gate wrapping the authenticated app (it is the `app` route's component, so it renders
 * for authed users only — the route's beforeLoad already bounced the unauthenticated to /login). It shows
 * the {@link ConsentScreen} to a user who has NOT accepted the current Terms/Privacy, otherwise the normal
 * {@link AppShell} (which hosts the screens via its Outlet).
 *
 * FAIL-CLOSED but RECOVERABLE: the board is revealed ONLY on a definitive `consented === true`. While the
 * consent status is loading, or if `GET /consent` errors, the gate shows a neutral loading/retry panel — NOT
 * the board — so a never-consented user can't slip past during a server blip. It's recoverable rather than a
 * lockout: the query retries (inherited), and the error panel offers a manual retry; when the server is back
 * the gate resolves. (The app's data all comes from the same server, so blocking on a consent-read failure
 * is no worse than the board being unusable anyway.)
 */
export function ConsentGate() {
  const { data, isPending, isError, refetch } = useConsent();

  if (isPending) return <ConsentFallback>טוען…</ConsentFallback>;
  if (isError) {
    return (
      <ConsentFallback>
        <p role="alert">לא הצלחנו לבדוק את ההסכמה כרגע.</p>
        <Button variant="ink" className="mt-4" onClick={() => refetch()}>
          נסו שוב
        </Button>
      </ConsentFallback>
    );
  }
  if (!data.consented) return <ConsentScreen />;
  return <AppShell />;
}
