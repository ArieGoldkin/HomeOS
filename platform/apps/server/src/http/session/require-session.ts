import type { Context, MiddlewareHandler } from "hono";
import { PLACEHOLDER_USER_ID_PREFIX } from "../../db/family-store.ts";
import type { ClaimPendingInvite } from "../../db/invite-claim.ts";
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
  /** Lower-cased login-email allowlist (`ALLOWED_LOGIN_EMAILS`) — #260: the break-glass admission FLOOR +
   *  owner-bootstrap path, OR'd with DB membership (a member row admits on its own). */
  allowedEmails: ReadonlySet<string>;
  /**
   * Pull the raw access-token JWT out of the request COOKIE (the same-origin SPA path), or null when
   * absent. The `Authorization: Bearer` header (API clients) is checked FIRST and needs no extractor,
   * so this only runs for cookie sessions. Injectable so the middleware is unit-testable offline.
   */
  extractCookieToken?: (c: Context) => Promise<string | null> | string | null;
  /**
   * #226/#260 / uid↔member binding — resolve the verified user's membership → `{familyId, role}` from the DB,
   * keyed on the session's verified login EMAIL (the placeholder `user_id` never equals the real
   * `auth.uid()`, so email is the link). A non-null result is now an AUTHORITATIVE admission path (#260): the
   * user is let in even if not on the static allowlist. Null ⇒ admission falls to the `allowedEmails` floor,
   * and `{familyId, role}` to the N=1 fallback (no lockout). Injected so the middleware stays unit-testable.
   */
  resolveMembershipByEmail: (email: string) => { familyId: string; role: string } | null;
  /**
   * #250 (Slice 2) — claim-on-first-login: when a verified session is NEITHER a returning member NOR on the
   * static floor, try to claim a pending email-scoped invite. A non-null result provisions a real-uid member
   * row and admits the session with the invite's `{familyId, role}` (self-serve allowlist, no env edit). Null
   * ⇒ no pending invite (or the write failed, fail-closed) ⇒ 403. OPTIONAL + injected: undefined ⇒ no claim
   * path (behavior identical to #260 — admission is membership OR the floor only), keeping it dormant-safe.
   */
  claimInvite?: ClaimPendingInvite;
  /**
   * #266 — FAIL-OPEN: after an admitted member resolves, upgrade their PLACEHOLDER `family_members.user_id`
   * (the email-genesis owner `placeholder:email:<email>`, or a legacy `placeholder:<phone>`) to the session's
   * real `auth.uid()`, matched by family + email — so the deferred `auth.uid() = user_id` RLS resolves later.
   * OPTIONAL + injected; the gate wraps it so a reconcile error can NEVER block an already-admitted session
   * (no-lockout). Undefined ⇒ no reconcile (dormant-safe).
   */
  reconcileMemberUid?: (member: { familyId: string; email: string; userId: string }) => void;
  /** #226 — familyId to attach when membership resolution returns null (N=1: the single FAMILY_ID). */
  fallbackFamilyId: string;
  /** #226 — role to attach when membership resolution returns null. Must permit writes (no lockout at N=1). */
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
 * (3, #226/#260) resolves DB membership by the verified email and admits if EITHER a `family_members` row
 * exists OR the email is on the `ALLOWED_LOGIN_EMAILS` floor, then attaches `{userId, email, familyId, role}`
 * to the context (familyId/role from the row, or the single family + a writer role at N=1, so the live login
 * never locks out).
 *   - missing / unverifiable token          → 401
 *   - verified but neither member nor floor  → 403
 *
 * The READ/WRITE split (formerly distinct readToken/writeToken) is now a ROLE check: every admitted member
 * reads, and writes go through {@link requireWrite} (#226) — a `viewer` is read-only. At N=1 every member is
 * a writer, so writes behave exactly as before.
 */
export function requireSession(config: RequireSessionConfig): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c) ?? (await config.extractCookieToken?.(c)) ?? null;
    if (!token) return c.text("Unauthorized", 401);
    const claims = await verifyAccessToken(token, config.getKey, config.verify);
    if (!claims) return c.text("Unauthorized", 401);
    // #260 — membership is an AUTHORITATIVE admission path (resolved FIRST, keyed on the verified email): a
    // `family_members` row admits on its own. The `ALLOWED_LOGIN_EMAILS` allowlist is retained as the
    // break-glass floor (and the owner-bootstrap path), so dropping `MEMBER_EMAILS` can never lock the live
    // login out. familyId/role come from the row, falling back at N=1 (allowlisted but no member row yet) to
    // the single family + a writer role.
    let resolved = config.resolveMembershipByEmail(claims.email);
    if (resolved === null && !config.allowedEmails.has(claims.email.toLowerCase())) {
      // #250 — NEITHER a returning member NOR on the floor: this is the self-serve invite path. Try to claim a
      // pending email-scoped invite (writes a real-uid member row, marks it claimed). A successful claim admits
      // with the invite's {familyId, role}; no pending invite (or a fail-closed write error) ⇒ 403. When the
      // claim seam is unwired (undefined), this is exactly the #260 gate — admission is membership OR floor only.
      resolved = config.claimInvite?.({ email: claims.email, userId: claims.userId }) ?? null;
      if (resolved === null) return c.text("Forbidden", 403);
    }
    // #266 — FAIL-OPEN uid reconcile: upgrade the admitted member's PLACEHOLDER row to the real auth.uid (the
    // JWT `sub`), so `auth.uid() = user_id` RLS resolves at the deferred Postgres migration with no backfill.
    // Only for an admitted member (resolved !== null) carrying a real session uid; wrapped so a reconcile
    // error can NEVER block an already-admitted session (the no-lockout red line). A no-op once the uid is real
    // (the store's `LIKE 'placeholder:%'` guard) and when the claim path just wrote the real-uid row.
    if (resolved !== null && !claims.userId.startsWith(PLACEHOLDER_USER_ID_PREFIX)) {
      try {
        config.reconcileMemberUid?.({
          familyId: resolved.familyId,
          email: claims.email,
          userId: claims.userId,
        });
      } catch {
        // fail-open: an admitted session is never blocked by a reconcile failure
      }
    }
    c.set("userId", claims.userId);
    c.set("email", claims.email);
    c.set("familyId", resolved?.familyId ?? config.fallbackFamilyId);
    c.set("role", resolved?.role ?? config.defaultRole);
    await next();
  };
}

/** #226 — roles permitted to write. An ALLOW-LIST (fail-closed): an unknown / mistyped / missing role is
 *  DENIED, not granted — the right default for a chokepoint with no RLS backstop. Expand as roles are added. */
const WRITER_ROLES: ReadonlySet<string> = new Set(["owner", "member"]);

/**
 * #226 — the write gate, replacing the old WRITE-token-vs-READ-token split with a ROLE check on the session
 * resolved by {@link requireSession} (which MUST run first, so `role` is on the context). FAIL-CLOSED: only a
 * role in {@link WRITER_ROLES} writes — a `viewer`, an unknown/future role, or a missing one → 403. At N=1 the
 * default role is `member` (a writer), so writes behave exactly as before until a non-writer role exists.
 */
export function requireWrite(): MiddlewareHandler {
  return async (c, next) => {
    const role = c.get("role") as string | undefined;
    if (!role || !WRITER_ROLES.has(role)) return c.text("Forbidden", 403);
    await next();
  };
}

/**
 * #250 — the owner-only gate for the invite admin surface (POST/GET/DELETE /invites). FAIL-CLOSED and
 * narrower than {@link requireWrite}: only the exact role `owner` passes — a `member`, `viewer`, an
 * unknown/future role, or a missing one → 403. {@link requireSession} MUST run first so `role` is on the
 * context. This keeps minting invites (which grants admission) an owner-only act, never a writer's.
 */
export function requireOwner(): MiddlewareHandler {
  return async (c, next) => {
    if (c.get("role") !== "owner") return c.text("Forbidden", 403);
    await next();
  };
}
