import type { Context, MiddlewareHandler } from "hono";
import { type KeyResolver, type VerifyOptions, verifyAccessToken } from "./verify.ts";

/** Context vars attached by {@link requireSession} once a session verifies. */
export interface SessionVars {
  userId: string;
  email: string;
}

export interface RequireSessionConfig {
  /** JWKS resolver — prod: `remoteJwks(url)`; tests: `createLocalJWKSet`. */
  getKey: KeyResolver;
  /** Verify options — issuer `${SUPABASE_URL}/auth/v1`, audience defaults to "authenticated". */
  verify: VerifyOptions;
  /** Lower-cased allowlist of permitted login emails (`ALLOWED_LOGIN_EMAILS`). */
  allowedEmails: ReadonlySet<string>;
  /**
   * Pull the raw access-token JWT out of the request COOKIE (the same-origin SPA path), or null when
   * absent. The `Authorization: Bearer` header (API clients) is checked FIRST and needs no extractor,
   * so this only runs for cookie sessions. Injectable so the middleware is unit-testable offline.
   */
  extractCookieToken?: (c: Context) => Promise<string | null> | string | null;
}

const BEARER = "Bearer ";

/** Pull a `Bearer <jwt>` access token from the Authorization header, or null. */
function bearerToken(c: Context): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith(BEARER) ? h.slice(BEARER.length) : null;
}

/**
 * #225 — Hono middleware that replaces the build-embedded shared-bearer gate (`bearerMatches`) with a
 * real per-user session check. It (1) reads the access-token JWT from `Authorization: Bearer` OR the
 * same-origin Supabase cookie, (2) verifies it LOCALLY (jose, cached JWKS — no Supabase round-trip),
 * (3) enforces the `ALLOWED_LOGIN_EMAILS` allowlist, then attaches `{userId,email}` to the context.
 *   - missing / unverifiable token  → 401
 *   - verified but not allowlisted   → 403
 *
 * The READ/WRITE split (formerly distinct readToken/writeToken) collapses for now into this one gate:
 * any allowlisted, logged-in user reads AND writes — strictly stronger than a shared static string.
 * Real per-member RBAC arrives with `family_members.role` (#226+).
 */
export function requireSession(config: RequireSessionConfig): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c) ?? (await config.extractCookieToken?.(c)) ?? null;
    if (!token) return c.text("Unauthorized", 401);
    const claims = await verifyAccessToken(token, config.getKey, config.verify);
    if (!claims) return c.text("Unauthorized", 401);
    if (!config.allowedEmails.has(claims.email.toLowerCase())) {
      return c.text("Forbidden", 403);
    }
    c.set("userId", claims.userId);
    c.set("email", claims.email);
    await next();
  };
}
