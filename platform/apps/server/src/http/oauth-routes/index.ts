import type { Context, Hono, MiddlewareHandler } from "hono";
import { sqliteUtc } from "../../core/time.ts";
// #229 — the browser/OAuth path still reads the single-family FAMILY_ID below. DEFERRED on purpose: it
// resolves via `resolveFamilyByUser(session.uid)`, but no real session identity exists until #226 (Supabase
// login). The resolver method is built + tested now (db/family-resolver.ts); these call sites finish
// threading when #226 lands a session to resolve from. The `assertSingleFamily` trip-wire stays meanwhile.
import { FAMILY_ID } from "../../db/schema.ts";
import { buildGoogleAuthUrl, GOOGLE_SCOPES, type GoogleOAuthClient } from "../../google/oauth.ts";
import { createRateLimiter, mismatchDelay } from "../rate-limit.ts";
import { type GoogleOAuthDeps, gateMatches } from "./deps.ts";
import { finish } from "./pages.ts";

// Public surface of the Google OAuth routes (split out of the former 296-LOC oauth-routes.ts; see
// docs/refactor/server-decomposition-plan.md, P2). The deps contract + composition seam live in
// deps.ts, the static result pages + redirect-safe finish() in pages.ts; the route registration +
// reversible disconnect stay here. This re-exports the EXACT prior public surface so importers only
// repoint the path. The FAMILY_ID usage below is the #229-deferred single-family path (no resolver
// threaded here — it rides #226; assertSingleFamily stays).
export type { GoogleOAuthDeps } from "./deps.ts";
export { buildGoogleDeps, gateMatches } from "./deps.ts";

const MAX_CODE = 2048;
const MAX_STATE = 512;
const MAX_ERR = 256;

/**
 * #108 — revoke at Google (the PRIMARY kill-switch) then ALWAYS delete locally and purge
 * provider-derived rows (#61/MF5). Extracted from the legacy disconnect body so both the admin curl
 * path and the self-serve `POST /oauth/google/disconnect` route share one reversible teardown.
 */
async function performDisconnect(deps: GoogleOAuthDeps): Promise<void> {
  const cred = deps.credentials.get(FAMILY_ID);
  if (cred) {
    try {
      await deps.client.revoke(cred.refreshToken);
    } catch (err) {
      deps.log?.("oauth revoke failed (continuing to delete locally)", { err: String(err) });
    }
  }
  deps.credentials.delete(FAMILY_ID);
  deps.events.deleteByProvider("google"); // purge provider-derived rows (#61/MF5; 0 until #17/#18 tag them)
}

export function registerOAuthRoutes(
  app: Hono,
  deps?: GoogleOAuthDeps,
  sessionGuard?: MiddlewareHandler,
): void {
  const dark = (c: Context) => c.text("Google OAuth not configured", 503);
  const limiter =
    deps?.rateLimiter ?? createRateLimiter({ windowMs: 60_000, max: 10, mismatchDelayMs: 0 });
  const clientIp = (c: Context): string =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  app.get("/oauth/google/callback", async (c) => {
    if (!deps) return dark(c);
    const q = c.req.query();
    // OG18: bound the params before any work (state is a known ~43-char base64url).
    if (
      (q.code?.length ?? 0) > MAX_CODE ||
      (q.state?.length ?? 0) > MAX_STATE ||
      (q.error?.length ?? 0) > MAX_ERR
    ) {
      return finish(c, deps, "bad_state");
    }
    if (q.error) return finish(c, deps, "cancelled"); // access_denied etc — no exchange, nothing stored
    // State validated FIRST (single-use, family-bound, unexpired) — before any token exchange.
    if (!q.state || !deps.credentials.consumeState(q.state, FAMILY_ID)) {
      return finish(c, deps, "bad_state");
    }
    if (!q.code) return finish(c, deps, "bad_state");

    let tokens: Awaited<ReturnType<GoogleOAuthClient["exchangeCode"]>>;
    try {
      tokens = await deps.client.exchangeCode(q.code);
    } catch (err) {
      deps.log?.("oauth callback exchange failed", { err: String(err) });
      return finish(c, deps, "error");
    }
    if (!tokens.refreshToken) return finish(c, deps, "no_refresh"); // store nothing — can't refresh later
    // OG17: validate the GRANTED scopes (a user can deselect on the consent screen).
    const granted = new Set(tokens.scope.split(" ").filter(Boolean));
    if (!GOOGLE_SCOPES.every((s) => granted.has(s))) {
      deps.log?.("oauth callback missing a required scope", { scope: tokens.scope });
      return finish(c, deps, "bad_scope");
    }
    // #109 overwrite-guard: never silently clobber a present credential — require disconnect-first.
    if (deps.credentials.get(FAMILY_ID)) {
      deps.log?.("oauth callback refused: a credential is already connected (disconnect first)");
      return finish(c, deps, "bad_account");
    }
    // #109 account pin: when an allowed email is configured, the consenting account MUST match it.
    if (deps.allowedEmail) {
      let email: string;
      try {
        email = await deps.client.getEmail(tokens.accessToken);
      } catch (err) {
        deps.log?.("oauth callback getEmail failed", { err: String(err) });
        return finish(c, deps, "error");
      }
      // Case-insensitive — email addresses are effectively case-insensitive, so a capitalization
      // difference (e.g. Fam@example.com vs fam@example.com) must not surprise-reject the right account.
      if (email.toLowerCase() !== deps.allowedEmail.toLowerCase()) {
        deps.log?.("oauth callback refused: account does not match the allowed email");
        return finish(c, deps, "bad_account");
      }
    }
    const now = deps.now ?? (() => new Date());
    const expiry = sqliteUtc(new Date(now().getTime() + (tokens.expiresIn - 60) * 1000)); // MF3
    deps.credentials.upsert(FAMILY_ID, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiry,
      scopes: [...granted],
    });
    return finish(c, deps, "connected");
  });

  // #108/#225 — the family app polls this to render the Connect screen. SESSION-gated via the shared
  // `sessionGuard` (a real per-user Supabase session, allowlisted by email) — this REPLACES the retired
  // build-embedded readToken. NEVER leaks token material (OG3): only `connected` + the granted `scopes`
  // + the access-token `expiresAt`. When no guard is supplied (session unconfigured), the route is dark (503).
  const statusGuard: MiddlewareHandler =
    sessionGuard ?? (async (c) => c.text("Auth not configured", 503));
  app.get("/oauth/google/status", statusGuard, (c) => {
    if (!deps) return dark(c);
    const cred = deps.credentials.get(FAMILY_ID);
    if (!cred) return c.json({ connected: false });
    return c.json({ connected: true, scopes: cred.scopes, expiresAt: cred.expiry });
  });

  // #108 — the self-serve consent-URL mint. Rate-limited per IP FIRST (429), then the dual-token gate
  // BEFORE issueState so an unauth probe mints NO state row. ADMIN_TOKEN passes (the curl escape hatch).
  app.get("/oauth/google/connect-url", async (c) => {
    if (!deps) return dark(c);
    if (limiter.check(clientIp(c)).limited) return c.text("Too Many Requests", 429);
    if (!gateMatches(c.req.header("authorization"), deps)) {
      await mismatchDelay(limiter.mismatchDelayMs);
      return c.text("Unauthorized", 401);
    }
    const state = deps.credentials.issueState(FAMILY_ID);
    return c.json({ url: buildGoogleAuthUrl(deps.config, state) });
  });

  // #108 — self-serve disconnect. Dual-token gated; revoke + delete + purge (reversible, AC4).
  app.post("/oauth/google/disconnect", async (c) => {
    if (!deps) return dark(c);
    if (!gateMatches(c.req.header("authorization"), deps)) {
      return c.text("Unauthorized", 401);
    }
    await performDisconnect(deps);
    return c.json({ disconnected: true });
  });
}
