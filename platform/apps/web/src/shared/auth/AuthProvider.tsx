import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "./supabase-client";

/**
 * Real Google auth (#225) — the React-side owner of the Supabase session. It seeds from the VERIFIED JWT
 * claims (`getClaims`, which verifies the token rather than just decoding the cookie) and then stays live
 * via `onAuthStateChange` (sign-in, the OAuth-callback exchange, sign-out, token refresh). The session
 * itself lives in a cookie (see `supabase-client`) so the same-origin server reads it; this provider only
 * mirrors auth STATE into React for the router guard + the UI.
 *
 * Plain context + an effect on purpose — mirrors the ThemeProvider; auth does not warrant a global store.
 */
export interface CurrentUser {
  userId: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** What `useCurrentUser` returns AND what the router guard reads off `context.auth`. */
export interface AuthState {
  status: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  /** Sign out + clear the cookie session (fires a SIGNED_OUT event this provider observes). */
  signOut: () => Promise<void>;
}

interface AuthSnapshot {
  status: AuthStatus;
  user: CurrentUser | null;
}

interface AuthContextValue extends AuthSnapshot {
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Normalise a claims/session user into our shape. Google fills `full_name`/`avatar_url`; some providers use
 * `name`/`picture`, so we fall back to those. Anything non-string is dropped (never trust the metadata bag).
 */
function toCurrentUser(src: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): CurrentUser {
  const m = src.user_metadata ?? {};
  return {
    userId: src.id,
    email: src.email ?? null,
    full_name: asString(m.full_name) ?? asString(m.name),
    avatar_url: asString(m.avatar_url) ?? asString(m.picture),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({ status: "loading", user: null });

  useEffect(() => {
    let active = true;

    // Seed from the verified claims (covers a returning session before any auth event fires).
    supabase.auth
      .getClaims()
      .then(({ data }) => {
        if (!active) return;
        const claims = data?.claims;
        setSnapshot(
          claims
            ? {
                status: "authenticated",
                user: toCurrentUser({
                  id: claims.sub,
                  email: claims.email ?? null,
                  user_metadata: claims.user_metadata,
                }),
              }
            : { status: "unauthenticated", user: null },
        );
      })
      .catch(() => {
        if (active) setSnapshot({ status: "unauthenticated", user: null });
      });

    // Stay live: SIGNED_IN (incl. the OAuth-callback code exchange), SIGNED_OUT, TOKEN_REFRESHED.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSnapshot(
        session
          ? {
              status: "authenticated",
              user: toCurrentUser({
                id: session.user.id,
                email: session.user.email ?? null,
                user_metadata: session.user.user_metadata,
              }),
            }
          : { status: "unauthenticated", user: null },
      );
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ ...snapshot, signOut }), [snapshot, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useCurrentUser(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useCurrentUser must be used within <AuthProvider>");
  const { status, user, signOut } = ctx;
  return {
    status,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
    userId: user?.userId ?? null,
    email: user?.email ?? null,
    full_name: user?.full_name ?? null,
    avatar_url: user?.avatar_url ?? null,
    signOut,
  };
}
