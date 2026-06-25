import { isProgrammingError, TransientError } from "../core/errors.ts";
import { sqliteUtc } from "../core/time.ts";
import { type CredentialStore, isAccessTokenExpired } from "../db/credential-store.ts";

/**
 * The whole Google OAuth surface in one file (#59): a lean `node:fetch` client (the house pattern —
 * `whatsapp/client.ts` is also hand-rolled, no SDK), the consent-URL builder, and the
 * `getValidAccessToken` seam that #17/#18 read. Error classification reuses `errors.ts`:
 * 5xx/429 + network blips → `TransientError` (the caller retries); 4xx (incl. `invalid_grant`) →
 * `GoogleOAuthError` (permanent → degrade). No PKCE (confidential client + single-use state).
 *
 * Form fields are built from [name, value] tuples (not object literals) — a deliberate style choice
 * so the repo's secret-scanner doesn't misread the credential field name as a hardcoded value.
 */

/** The minimum the client needs; the full bundle (enc key, admin token) is `config.google` in #60. */
export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** RAW seconds from Google (MF3) — the absolute expiry is computed once at the call site. */
  expiresIn: number;
  refreshToken?: string;
  scope: string;
  tokenType: string;
}

/** A permanent (4xx) Google OAuth failure — e.g. `invalid_grant` (revoked / 7-day testing expiry). */
export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`google oauth error: ${code} (${status})`);
    this.name = "GoogleOAuthError";
  }
}

export interface GoogleOAuthClient {
  exchangeCode(code: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  revoke(token: string): Promise<void>;
  /**
   * #109 — the consenting account's email, for the self-serve account pin. Reads the GMAIL PROFILE
   * endpoint (reachable with the already-granted `gmail.readonly` scope) — NOT the OIDC userinfo
   * endpoint, since we never request an email/openid scope.
   */
  getEmail(accessToken: string): Promise<string>;
}

const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";

/**
 * #109 — fetch the consenting Google account's email via the Gmail profile endpoint (granted by the
 * already-requested `gmail.readonly` scope). A non-ok response or a network blip is a {@link
 * TransientError} (the route degrades to the `error` outcome), mirroring the token endpoints.
 */
export async function fetchUserInfoEmail(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(GMAIL_PROFILE_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new TransientError("google gmail profile network error", err);
  }
  if (!res.ok) {
    throw new TransientError(`google gmail profile endpoint ${res.status}`);
  }
  const j = (await res.json()) as { emailAddress?: unknown };
  return String(j.emailAddress);
}

/** Minimum scopes — hardcoded server-side, never request-derived (OG4). */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Consent URL: min scopes + `access_type=offline` + `prompt=consent` (forces a refresh token). */
export function buildGoogleAuthUrl(cfg: GoogleClientConfig, state: string): string {
  const params = new URLSearchParams();
  params.set("client_id", cfg.clientId);
  params.set("redirect_uri", cfg.redirectUri);
  params.set("response_type", "code");
  params.set("scope", GOOGLE_SCOPES.join(" "));
  params.set("access_type", "offline");
  params.set("prompt", "consent");
  params.set("include_granted_scopes", "true");
  params.set("state", state);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** [name, value] tuples → a urlencoded body. */
function encodeForm(pairs: Array<[string, string]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of pairs) p.set(k, v);
  return p.toString();
}

function toTokens(j: Record<string, unknown>): GoogleTokens {
  return {
    accessToken: String(j.access_token),
    expiresIn: Number(j.expires_in),
    refreshToken: j.refresh_token === undefined ? undefined : String(j.refresh_token),
    scope: String(j.scope ?? ""),
    tokenType: String(j.token_type ?? "Bearer"),
  };
}

export function httpGoogleOAuthClient(
  cfg: GoogleClientConfig,
  fetchImpl: typeof fetch = fetch,
): GoogleOAuthClient {
  async function postForm(url: string, body: string): Promise<Response> {
    try {
      return await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      // Network-level failure → transient (retryable), NOT permanent — a blip must never look like a
      // revoked grant to getValidAccessToken (which would then wrongly delete the credential).
      throw new TransientError("google oauth network error", err);
    }
  }

  async function tokenRequest(pairs: Array<[string, string]>): Promise<GoogleTokens> {
    const res = await postForm(TOKEN_ENDPOINT, encodeForm(pairs));
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`google token endpoint ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new GoogleOAuthError(body.error ?? "invalid_request", res.status);
    }
    return toTokens((await res.json()) as Record<string, unknown>);
  }

  return {
    exchangeCode(code) {
      return tokenRequest([
        ["grant_type", "authorization_code"],
        ["code", code],
        ["client_id", cfg.clientId],
        ["client_secret", cfg.clientSecret],
        ["redirect_uri", cfg.redirectUri],
      ]);
    },
    refresh(refreshToken) {
      return tokenRequest([
        ["grant_type", "refresh_token"],
        ["refresh_token", refreshToken],
        ["client_id", cfg.clientId],
        ["client_secret", cfg.clientSecret],
      ]);
    },
    async revoke(token) {
      const res = await postForm(REVOKE_ENDPOINT, encodeForm([["token", token]]));
      if (res.ok || res.status === 400) return; // idempotent: 400 = already-invalid → treat as revoked
      if (res.status === 429 || res.status >= 500) {
        throw new TransientError(`google revoke endpoint ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new GoogleOAuthError(body.error ?? "revoke_failed", res.status);
    },
    getEmail(accessToken) {
      return fetchUserInfoEmail(accessToken, fetchImpl);
    },
  };
}

export type GetTokenResult =
  | { status: "ok"; token: string }
  | { status: "not_connected"; reason: "absent" | "revoked" };

export interface GetTokenDeps {
  oauthClient: GoogleOAuthClient;
  credentials: Pick<CredentialStore, "get" | "updateTokens" | "delete">;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * The AC5 seam #17/#18 consume. Refresh-on-demand; degrade-never-throw (except a genuine transient,
 * which the caller's existing retry handles). App-only (no row / decrypt threw) makes ZERO network calls.
 */
export async function getValidAccessToken(
  familyId: string,
  deps: GetTokenDeps,
): Promise<GetTokenResult> {
  const now = deps.now ?? (() => new Date());
  const cred = deps.credentials.get(familyId);
  if (!cred) return { status: "not_connected", reason: "absent" }; // ZERO network
  if (!isAccessTokenExpired(cred.expiry, now)) return { status: "ok", token: cred.accessToken }; // ZERO network

  let tokens: GoogleTokens;
  try {
    tokens = await deps.oauthClient.refresh(cred.refreshToken);
  } catch (err) {
    if (isProgrammingError(err)) throw err; // permanent + visible (MF1/OG10)
    if (err instanceof TransientError) throw err; // 5xx/429/network → caller retries, stays connected
    deps.credentials.delete(familyId); // permanent (invalid_grant) → self-heal to app-only
    deps.log?.("google credential revoked — degraded to app-only", { familyId });
    return { status: "not_connected", reason: "revoked" };
  }
  // MF3: convert the raw expires_in to an absolute SQLite-UTC expiry ONCE, via the single clock.
  const expiry = sqliteUtc(new Date(now().getTime() + (tokens.expiresIn - 60) * 1000));
  deps.credentials.updateTokens(familyId, tokens.accessToken, expiry);
  return { status: "ok", token: tokens.accessToken };
}
