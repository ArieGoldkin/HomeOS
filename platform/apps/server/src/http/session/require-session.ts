import type { Context, MiddlewareHandler } from "hono";
import { type KeyResolver, type VerifyOptions, verifyAccessToken } from "./verify.ts";

/** Context vars attached by {@link requireSession} once a session verifies. */
export interface SessionVars {
  userId: string;
  email: string;
  /** #226 — the member's family (request scope) + role (write gate). At N=1 these fall back to the single
   *  FAMILY_ID + a writer role until real-uid membership rows exist (see requireSession). */
  familyId: string;
  role: string;
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
  /**
   * #226 — resolve the verified user's membership → `{familyId, role}` (the DB family_members lookup), or
   * null when the uid isn't a member row yet (the N=1 reality until real-uid binding lands). Injected so the
   * middleware stays unit-testable offline.
   */
  resolveMembership: (userId: string) => { familyId: string; role: string } | null;
  /** #226 — familyId to attach when resolveMembership returns null (N=1: the single FAMILY_ID). */
  fallbackFamilyId: string;
  /** #226 — role to attach when resolveMembership returns null. Must permit writes (no lockout at N=1). */
  defaultRole: string;
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
 * (3) enforces the `ALLOWED_LOGIN_EMAILS` allowlist, then (4, #226) resolves DB membership and attaches
 * `{userId, email, familyId, role}` to the context (familyId/role fall back to the single family + a writer
 * role at N=1, so the live login never locks out).
 *   - missing / unverifiable token  → 401
 *   - verified but not allowlisted   → 403
 *
 * The READ/WRITE split (formerly distinct readToken/writeToken) is now a ROLE check: every allowlisted member
 * reads, and writes go through {@link requireWrite} (#226) — a `viewer` is read-only. At N=1 every member is
 * a writer, so writes behave exactly as before.
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
    // #226 — derive the request's family scope + role from DB membership; fall back at N=1 (no member row
    // keyed by the real auth.uid yet) to the single family + a writer role so the live login never locks out.
    const membership = config.resolveMembership(claims.userId);
    c.set("userId", claims.userId);
    c.set("email", claims.email);
    c.set("familyId", membership?.familyId ?? config.fallbackFamilyId);
    c.set("role", membership?.role ?? config.defaultRole);
    await next();
  };
}

/**
 * #226 — the write gate, replacing the old WRITE-token-vs-READ-token split with a ROLE check on the session
 * resolved by {@link requireSession} (which MUST run first, so `role` is on the context). Any member writes
 * EXCEPT an explicit `viewer`; a missing role (shouldn't happen post-requireSession) is treated as
 * non-writer → 403. At N=1 the default role is a writer, so this is a no-op until a `viewer` exists.
 */
export function requireWrite(): MiddlewareHandler {
  return async (c, next) => {
    const role = c.get("role");
    if (!role || role === "viewer") return c.text("Forbidden", 403);
    await next();
  };
}
