import { CONNECT_OUTCOMES, type ConnectOutcome } from "@homeos/shared";
import type { Context, Hono } from "hono";
import type { GoogleOAuthSettings } from "../config.ts";
import { sqliteUtc } from "../core/time.ts";
import { type CredentialStore, createCredentialStore } from "../db/credential-store.ts";
import type { EventStore } from "../db/event-store.ts";
import { FAMILY_ID } from "../db/schema.ts";
import {
  buildGoogleAuthUrl,
  GOOGLE_SCOPES,
  type GoogleClientConfig,
  type GoogleOAuthClient,
  httpGoogleOAuthClient,
} from "../google/oauth.ts";
import { createRateLimiter, mismatchDelay, type RateLimiter } from "./rate-limit.ts";
import { bearerMatches } from "./server.ts";

/**
 * Google OAuth routes (#60) — connect / callback / disconnect. The routes file IS the orchestrator
 * (no service layer), mirroring handler.ts. These are the first HTML surface in the codebase, so the
 * result page is a STATIC string chosen from an allowlisted outcome enum — never interpolates a raw
 * query param — with a strict CSP (OG16). Reached only via the admin bearer (OG20) + single-use
 * state (OG7); the redirect_uri is pinned config, never derived from request headers (OG14).
 */
export interface GoogleOAuthDeps {
  client: GoogleOAuthClient;
  credentials: CredentialStore;
  /** Read model — used by disconnect to purge provider-derived rows (#61/MF5). */
  events: Pick<EventStore, "deleteByProvider">;
  config: GoogleClientConfig;
  adminToken: string;
  /** #107 — self-serve Connect-Google bearer; a valid SETUP_TOKEN OR ADMIN_TOKEN passes the gate. */
  setupToken?: string;
  /** #106 — the family app's read token, threaded for the self-serve flow (#108 wires it). */
  readToken?: string;
  /** #106 — absolute return URL (`${WEB_BASE_URL}/connections`) for the self-serve flow. */
  webReturnUrl?: string;
  /** #106 — the single Google email the self-serve flow accepts (dogfood guard; #108 enforces it). */
  allowedEmail?: string;
  /** #108 — per-IP rate limiter for the self-serve connect-url mint. Defaulted when unset (injectable in tests). */
  rateLimiter?: RateLimiter;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * #107 — the self-serve gate: a valid SETUP_TOKEN bearer OR a valid ADMIN_TOKEN bearer passes (the
 * admin token is the curl escape hatch). Constant-time via {@link bearerMatches} (which already maps
 * an unset/empty token → false), so an absent/wrong header — or both tokens unset — returns false.
 */
export function gateMatches(
  header: string | undefined,
  deps: Pick<GoogleOAuthDeps, "setupToken" | "adminToken">,
): boolean {
  const setupOk = deps.setupToken ? bearerMatches(header, deps.setupToken) : false;
  return setupOk || bearerMatches(header, deps.adminToken);
}

// #10 — the page table is keyed off the SHARED {@link ConnectOutcome} (so the static fallback and the
// web `?status=` banner can only ever render the same allowlisted slug). The `Record<ConnectOutcome, …>`
// makes PAGES exhaustive by type; this runtime assert keeps the imported tuple load-bearing and fails
// loudly at module load if a new outcome slug is added to the shared enum without a page here.
const PAGES: Record<
  ConnectOutcome,
  { status: 200 | 400 | 403 | 502; title: string; body: string }
> = {
  connected: { status: 200, title: "מחובר ✅", body: "חשבון Google חובר בהצלחה." },
  cancelled: { status: 200, title: "בוטל", body: "החיבור בוטל. אפשר לנסות שוב בכל עת." },
  no_refresh: {
    status: 400,
    title: "צריך לאשר מחדש",
    body: "לא התקבל אישור קבוע. התחברו שוב ואשרו את כל ההרשאות המבוקשות.",
  },
  bad_scope: {
    status: 400,
    title: "הרשאות חסרות",
    body: "לא כל ההרשאות אושרו. התחברו שוב ואשרו את הגישה ל-Gmail וליומן.",
  },
  bad_state: {
    status: 403,
    title: "בקשה לא תקפה",
    body: "הבקשה פגה או אינה תקפה. התחילו את החיבור מחדש.",
  },
  bad_account: {
    status: 403,
    title: "חשבון לא תואם",
    body: "החשבון שאושר אינו החשבון המוגדר למשפחה. התחברו עם החשבון הנכון, או נתקו תחילה.",
  },
  error: {
    status: 502,
    title: "שגיאה",
    body: "אירעה שגיאה בחיבור ל-Google. נסו שוב מאוחר יותר.",
  },
};

// Fail loudly at module load if the shared enum gains an outcome with no page (defence-in-depth on top
// of the `Record<ConnectOutcome, …>` type — keeps the imported tuple load-bearing).
for (const outcome of CONNECT_OUTCOMES) {
  if (!PAGES[outcome]) throw new Error(`oauth-routes: missing page for outcome "${outcome}"`);
}

/** Static Hebrew RTL page from the allowlisted enum (no query interpolation) + strict CSP (OG16). */
function page(c: Context, outcome: ConnectOutcome): Response {
  const p = PAGES[outcome];
  const html =
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">` +
    `<title>${p.title}</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem">` +
    `<h1>${p.title}</h1><p>${p.body}</p></body></html>`;
  c.header("Content-Security-Policy", "default-src 'none'");
  return c.html(html, p.status);
}

const MAX_CODE = 2048;
const MAX_STATE = 512;
const MAX_ERR = 256;

/**
 * Compose GoogleOAuthDeps from the validated settings — the composition seam index.ts calls. Takes
 * the admin bearer as a plain param (read at the call site) so the wiring stays simple.
 *
 * #106 — threads the self-serve optionals: `setupToken` / `allowedEmail` straight from settings,
 * `webReturnUrl` derived as `${webBaseUrl}/connections` (undefined in admin-only mode), and the
 * family `readToken` passed by the caller (the route behavior change itself lands in #108).
 */
export function buildGoogleDeps(
  settings: GoogleOAuthSettings,
  dbPath: string,
  events: Pick<EventStore, "deleteByProvider">,
  readToken?: string,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): GoogleOAuthDeps {
  const adminToken = settings["adminToken"]; // index read (matches config.ts env access)
  const webReturnUrl = settings.webBaseUrl ? `${settings.webBaseUrl}/connections` : undefined;
  return {
    client: httpGoogleOAuthClient(settings),
    credentials: createCredentialStore(dbPath, settings.encKey),
    events,
    config: settings,
    adminToken,
    setupToken: settings.setupToken,
    readToken,
    webReturnUrl,
    allowedEmail: settings.allowedEmail,
    log,
  };
}

/**
 * #109 — the terminal step of the callback (and the new routes' page-rendering paths). When the
 * self-serve return URL is configured, bounce the browser back to the web app with ONLY the
 * server-constructed `?status=<outcome>` slug (an allowlisted {@link ConnectOutcome}) — NEVER forward
 * `code`/`state`/`error` from the inbound query (open-redirect-safe, OG21-OR) — and set
 * `Referrer-Policy: no-referrer` so the slug-bearing URL can't leak via the Referer header. In
 * admin-only mode (no return URL) fall back to the static Hebrew page (the ships-dark / curl path).
 */
function finish(c: Context, deps: GoogleOAuthDeps, outcome: ConnectOutcome): Response {
  if (deps.webReturnUrl) {
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(`${deps.webReturnUrl}?status=${outcome}`, 302);
  }
  return page(c, outcome);
}

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

export function registerOAuthRoutes(app: Hono, deps?: GoogleOAuthDeps): void {
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
      if (email !== deps.allowedEmail) {
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

  // #108 — the family app polls this to render the Connect screen. Read-token gated; NEVER leaks token
  // material (OG3) — only `connected` + the granted `scopes` + the access-token `expiresAt`.
  app.get("/oauth/google/status", (c) => {
    if (!deps) return dark(c);
    // readToken unset ⇒ gated off (mirrors GET /events). Guard it explicitly rather than fall through to
    // bearerMatches with an empty token — an empty `Bearer ` header would satisfy timingSafeEqual([],[]).
    if (
      deps.readToken === undefined ||
      !bearerMatches(c.req.header("authorization"), deps.readToken)
    ) {
      return c.text("Unauthorized", 401);
    }
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
