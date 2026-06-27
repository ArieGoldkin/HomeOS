import type { GoogleOAuthSettings } from "../../config.ts";
import { type CredentialStore, createCredentialStore } from "../../db/credential-store.ts";
import type { EventStore } from "../../db/event-store/index.ts";
import {
  type GoogleClientConfig,
  type GoogleOAuthClient,
  httpGoogleOAuthClient,
} from "../../google/oauth.ts";
import { bearerMatches } from "../auth.ts";
import type { RateLimiter } from "../rate-limit.ts";

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

/**
 * Compose GoogleOAuthDeps from the validated settings — the composition seam index.ts calls. Takes
 * the admin bearer as a plain param (read at the call site) so the wiring stays simple.
 *
 * #106 — threads the self-serve optionals: `setupToken` / `allowedEmail` straight from settings and
 * `webReturnUrl` derived as `${webBaseUrl}/connections` (undefined in admin-only mode). #225 retired the
 * `readToken` param — the `/oauth/google/status` route is now session-gated by `requireSession`.
 */
export function buildGoogleDeps(
  settings: GoogleOAuthSettings,
  dbPath: string,
  events: Pick<EventStore, "deleteByProvider">,
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
    webReturnUrl,
    allowedEmail: settings.allowedEmail,
    log,
  };
}
