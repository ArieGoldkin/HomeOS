import type { Context, Hono } from "hono";
import type { GoogleOAuthSettings } from "../config.ts";
import { sqliteUtc } from "../core/time.ts";
import { type CredentialStore, createCredentialStore } from "../db/credential-store.ts";
import { FAMILY_ID } from "../db/schema.ts";
import {
  buildGoogleAuthUrl,
  GOOGLE_SCOPES,
  type GoogleClientConfig,
  type GoogleOAuthClient,
  httpGoogleOAuthClient,
} from "../google/oauth.ts";
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
  config: GoogleClientConfig;
  adminToken: string;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

type Outcome = "connected" | "cancelled" | "no_refresh" | "bad_scope" | "bad_state" | "error";

const PAGES: Record<Outcome, { status: 200 | 400 | 403 | 502; title: string; body: string }> = {
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
  error: {
    status: 502,
    title: "שגיאה",
    body: "אירעה שגיאה בחיבור ל-Google. נסו שוב מאוחר יותר.",
  },
};

/** Static Hebrew RTL page from the allowlisted enum (no query interpolation) + strict CSP (OG16). */
function page(c: Context, outcome: Outcome): Response {
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
 */
export function buildGoogleDeps(
  settings: GoogleOAuthSettings,
  dbPath: string,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): GoogleOAuthDeps {
  const adminToken = settings["adminToken"]; // index read (matches config.ts env access)
  return {
    client: httpGoogleOAuthClient(settings),
    credentials: createCredentialStore(dbPath, settings.encKey),
    config: settings,
    adminToken,
    log,
  };
}

export function registerOAuthRoutes(app: Hono, deps?: GoogleOAuthDeps): void {
  const dark = (c: Context) => c.text("Google OAuth not configured", 503);

  // Admin, one-time: mint a single-use state, redirect to Google's consent screen.
  app.get("/connect/google", (c) => {
    if (!deps) return dark(c);
    if (!bearerMatches(c.req.header("authorization"), deps.adminToken)) {
      return c.text("Unauthorized", 401);
    }
    const state = deps.credentials.issueState(FAMILY_ID);
    return c.redirect(buildGoogleAuthUrl(deps.config, state), 302);
  });

  app.get("/oauth/google/callback", async (c) => {
    if (!deps) return dark(c);
    const q = c.req.query();
    // OG18: bound the params before any work (state is a known ~43-char base64url).
    if (
      (q.code?.length ?? 0) > MAX_CODE ||
      (q.state?.length ?? 0) > MAX_STATE ||
      (q.error?.length ?? 0) > MAX_ERR
    ) {
      return page(c, "bad_state");
    }
    if (q.error) return page(c, "cancelled"); // access_denied etc — no exchange, nothing stored
    // State validated FIRST (single-use, family-bound, unexpired) — before any token exchange.
    if (!q.state || !deps.credentials.consumeState(q.state, FAMILY_ID)) return page(c, "bad_state");
    if (!q.code) return page(c, "bad_state");

    let tokens: Awaited<ReturnType<GoogleOAuthClient["exchangeCode"]>>;
    try {
      tokens = await deps.client.exchangeCode(q.code);
    } catch (err) {
      deps.log?.("oauth callback exchange failed", { err: String(err) });
      return page(c, "error");
    }
    if (!tokens.refreshToken) return page(c, "no_refresh"); // store nothing — can't refresh later
    // OG17: validate the GRANTED scopes (a user can deselect on the consent screen).
    const granted = new Set(tokens.scope.split(" ").filter(Boolean));
    if (!GOOGLE_SCOPES.every((s) => granted.has(s))) {
      deps.log?.("oauth callback missing a required scope", { scope: tokens.scope });
      return page(c, "bad_scope");
    }
    const now = deps.now ?? (() => new Date());
    const expiry = sqliteUtc(new Date(now().getTime() + (tokens.expiresIn - 60) * 1000)); // MF3
    deps.credentials.upsert(FAMILY_ID, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiry,
      scopes: [...granted],
    });
    return page(c, "connected");
  });

  // Admin, reversible (AC4): revoke at Google (PRIMARY kill-switch) then ALWAYS delete locally.
  app.post("/disconnect/google", async (c) => {
    if (!deps) return dark(c);
    if (!bearerMatches(c.req.header("authorization"), deps.adminToken)) {
      return c.text("Unauthorized", 401);
    }
    const cred = deps.credentials.get(FAMILY_ID);
    if (cred) {
      try {
        await deps.client.revoke(cred.refreshToken);
      } catch (err) {
        deps.log?.("oauth revoke failed (continuing to delete locally)", { err: String(err) });
      }
    }
    deps.credentials.delete(FAMILY_ID);
    return c.text("נותק. חשבון Google נותק והמידע המקומי נמחק.", 200);
  });
}
