import type { Context, Hono, MiddlewareHandler } from "hono";
import { sqliteUtc } from "../../core/time.ts";
// #231 — the OAuth surface is now SESSION-gated: connect-url/disconnect run behind `guard` (requireSession),
// so the connect-initiator's {familyId, email} ride the single-use oauth_state row and the callback (no
// session needed) pins the connected Google account to that email. status reads the session familyId.
// `performDisconnect` still tears down the single FAMILY_ID (N=1); assertSingleFamily stays the trip-wire.
import { FAMILY_ID } from "../../db/schema.ts";
import { buildGoogleAuthUrl, GOOGLE_SCOPES, type GoogleOAuthClient } from "../../google/oauth.ts";
import { createRateLimiter } from "../rate-limit.ts";
import type { SessionVars } from "../session/index.ts";
import type { GoogleOAuthDeps } from "./deps.ts";
import { finish } from "./pages.ts";

// Public surface of the Google OAuth routes (split out of the former 296-LOC oauth-routes.ts; see
// docs/refactor/server-decomposition-plan.md, P2). The deps contract + composition seam live in
// deps.ts, the static result pages + redirect-safe finish() in pages.ts; the route registration +
// reversible disconnect stay here. This re-exports the EXACT prior public surface so importers only
// repoint the path. #231 session-gated the mutations + threaded the session familyId/email via oauth_state;
// performDisconnect keeps the single-family teardown. assertSingleFamily stays.
export type { GoogleOAuthDeps } from "./deps.ts";
export { buildGoogleDeps } from "./deps.ts";

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
    // State validated FIRST (single-use, unexpired) — before any token exchange. #231: it carries the
    // family + the connect-initiator's email, so the callback needs NO session of its own.
    const st = q.state ? deps.credentials.consumeState(q.state) : null;
    if (!st) {
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
    if (deps.credentials.get(st.familyId)) {
      deps.log?.("oauth callback refused: a credential is already connected (disconnect first)");
      return finish(c, deps, "bad_account");
    }
    // #231 — the connected Google account MUST be the logged-in user who STARTED the flow (the email rides
    // the single-use state). Case-insensitive (emails effectively are). Fail closed when the state predates
    // the email column (null): we can't verify, so refuse rather than connect the wrong account.
    let email: string;
    try {
      email = await deps.client.getEmail(tokens.accessToken);
    } catch (err) {
      deps.log?.("oauth callback getEmail failed", { err: String(err) });
      return finish(c, deps, "error");
    }
    if (!st.email || email.toLowerCase() !== st.email.toLowerCase()) {
      deps.log?.("oauth callback refused: connected account != the logged-in user");
      return finish(c, deps, "bad_account");
    }
    const now = deps.now ?? (() => new Date());
    const expiry = sqliteUtc(new Date(now().getTime() + (tokens.expiresIn - 60) * 1000)); // MF3
    deps.credentials.upsert(st.familyId, {
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
  // #225/#231 — the session gate shared by status + the connect/disconnect MUTATIONS. requireSession when
  // configured (per-user Supabase session, allowlisted by email), else the routes are dark (503). c.var
  // carries the resolved {familyId, email} (#226).
  const guard: MiddlewareHandler =
    sessionGuard ?? (async (c) => c.text("Auth not configured", 503));
  app.get("/oauth/google/status", guard, (c) => {
    if (!deps) return dark(c);
    const cred = deps.credentials.get((c.var as SessionVars).familyId);
    if (!cred) return c.json({ connected: false });
    return c.json({ connected: true, scopes: cred.scopes, expiresAt: cred.expiry });
  });

  // #231 — the consent-URL mint, now SESSION-gated (was a SETUP/ADMIN-token gate). The logged-in session's
  // {familyId, email} ride the single-use state so the callback can pin the connected account. Still
  // rate-limited per authenticated IP (a mild abuse guard).
  app.get("/oauth/google/connect-url", guard, async (c) => {
    if (!deps) return dark(c);
    if (limiter.check(clientIp(c)).limited) return c.text("Too Many Requests", 429);
    const { familyId, email } = c.var as SessionVars;
    const state = deps.credentials.issueState(familyId, email);
    return c.json({ url: buildGoogleAuthUrl(deps.config, state) });
  });

  // #231 — self-serve disconnect, now SESSION-gated (was dual-token). Revoke + delete + purge (reversible).
  app.post("/oauth/google/disconnect", guard, async (c) => {
    if (!deps) return dark(c);
    await performDisconnect(deps);
    return c.json({ disconnected: true });
  });
}
