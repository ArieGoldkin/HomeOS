import { useCurrentUser } from "@shared/auth";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";
import { router } from "./router";

/**
 * App entry: hosts the TanStack Router and bridges the Supabase auth STATE (React context) into the router
 * context so the route guard can gate the authed screens (#225). While the session is still resolving we
 * hold a minimal splash — the router (and its RootLayout RTL side-effect) mounts only once auth is known,
 * so the guard never races a "loading" state. QueryClientProvider + AuthProvider stay in main.tsx, above.
 */
export function App() {
  const auth = useCurrentUser();

  // A single key that flips on any auth transition (loading → in/out, or a later sign-in / sign-out / the
  // OAuth-return exchange completing after mount). RouterProvider's `context` prop updates the context but
  // does NOT re-run beforeLoad, so we invalidate on each post-load flip — re-running the guards (which read
  // auth off the router context) moves the user to /login or back onto the board without a manual reload.
  const authKey = auth.isLoading ? "loading" : auth.isAuthenticated ? "in" : "out";
  useEffect(() => {
    if (authKey !== "loading") router.invalidate();
  }, [authKey]);

  if (auth.isLoading) return <AuthSplash />;
  return <RouterProvider router={router} context={{ auth }} />;
}

/** A quiet full-screen hold while the Supabase session resolves (avoids a login/board flash). */
function AuthSplash() {
  return (
    <div
      className="paper-grain grid min-h-dvh place-items-center text-muted-foreground"
      aria-busy="true"
    >
      <span>טוען…</span>
    </div>
  );
}
