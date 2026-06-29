import type { GoogleOAuthSettings } from "../../config.ts";
import { type CredentialStore, createCredentialStore } from "../../db/credential-store.ts";
import type { EventStore } from "../../db/event-store/index.ts";
import {
  type GoogleClientConfig,
  type GoogleOAuthClient,
  httpGoogleOAuthClient,
} from "../../google/oauth.ts";
import type { RateLimiter } from "../rate-limit.ts";

/**
 * Google OAuth routes (#60) — connect / callback / disconnect. The routes file IS the orchestrator
 * (no service layer), mirroring handler.ts. These are the first HTML surface in the codebase, so the
 * result page is a STATIC string chosen from an allowlisted outcome enum — never interpolates a raw
 * query param — with a strict CSP (OG16). The redirect_uri is pinned config, never derived from request
 * headers (OG14).
 *
 * #231 — the connect/disconnect MUTATIONS are now SESSION-gated (requireSession), so the dual-token gate
 * (setupToken/adminToken) and the standalone allowedEmail pin are gone: the connect-initiator's session
 * {familyId, email} ride the single-use state, and the callback enforces connected-email == that email.
 */
export interface GoogleOAuthDeps {
  client: GoogleOAuthClient;
  credentials: CredentialStore;
  /** Read model — used by disconnect to purge provider-derived rows (#61/MF5). */
  events: Pick<EventStore, "deleteByProvider">;
  config: GoogleClientConfig;
  /** #106 — absolute return URL (`${WEB_BASE_URL}/connections`) for the self-serve flow. */
  webReturnUrl?: string;
  /** #108 — per-IP rate limiter for the self-serve connect-url mint. Defaulted when unset (injectable in tests). */
  rateLimiter?: RateLimiter;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Compose GoogleOAuthDeps from the validated settings — the composition seam index.ts calls.
 *
 * #106 — derives `webReturnUrl` as `${webBaseUrl}/connections` (undefined when WEB_BASE_URL is unset, ⇒
 * the callback renders the static Hebrew page). #225 retired the `readToken` param and #231 retired the
 * dual-token gate (setupToken/adminToken) + the allowedEmail pin — connect/disconnect are session-gated.
 */
export function buildGoogleDeps(
  settings: GoogleOAuthSettings,
  dbPath: string,
  events: Pick<EventStore, "deleteByProvider">,
  log?: (msg: string, meta?: Record<string, unknown>) => void,
): GoogleOAuthDeps {
  const webReturnUrl = settings.webBaseUrl ? `${settings.webBaseUrl}/connections` : undefined;
  return {
    client: httpGoogleOAuthClient(settings),
    credentials: createCredentialStore(dbPath, settings.encKey),
    events,
    config: settings,
    webReturnUrl,
    log,
  };
}
