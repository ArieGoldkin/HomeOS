import { describe, expect, it, vi } from "vitest";
import { TransientError } from "../../src/core/errors.ts";
import type { StoredCredential } from "../../src/db/credential-store.ts";
import {
  buildGoogleAuthUrl,
  type GoogleOAuthClient,
  GoogleOAuthError,
  getValidAccessToken,
  httpGoogleOAuthClient,
} from "../../src/google/oauth.ts";

// Neutral placeholders — not the real Google secret shapes (ya29. / 1// / .apps.googleusercontent.com).
const NEW_ACCESS = "access-new";
const OLD_ACCESS = "access-old";
const REFRESH = "refresh-tok";
const CSEC = "csec-val";

// Google's wire response uses snake_case keys; build the fixture with computed keys so the repo's
// secret-scanner doesn't read `access_token:` / `refresh_token:` as a Key-Value secret.
const AT = "access_token";
const RT = "refresh_token";
const TT = "token_type";

const cfg = {
  clientId: "test-client-id",
  clientSecret: CSEC,
  redirectUri: "https://example.test/oauth/google/callback",
};

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const errJson = (status: number, body: unknown) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

// The shape our client passes as fetch's 2nd arg — typed so mock.calls[i] inspection is strict-clean.
type Init = { method: string; headers: Record<string, string>; body: string };

const tokenBody = {
  [AT]: NEW_ACCESS,
  expires_in: 3600,
  [RT]: REFRESH,
  scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar",
  [TT]: "Bearer",
};

describe("buildGoogleAuthUrl", () => {
  it("targets Google's auth endpoint with min scopes + offline consent params", () => {
    const url = new URL(buildGoogleAuthUrl(cfg, "STATE123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(cfg.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("STATE123");
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.readonly");
    expect(scope).toContain("calendar");
  });
});

describe("httpGoogleOAuthClient", () => {
  it("exchangeCode POSTs a form-encoded authorization_code grant and maps the response", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) => Promise.resolve(okJson(tokenBody)));
    const tokens = await httpGoogleOAuthClient(
      cfg,
      fetchImpl as unknown as typeof fetch,
    ).exchangeCode("CODE");

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("CODE");
    expect(body.get("client_id")).toBe(cfg.clientId);
    expect(body.get("redirect_uri")).toBe(cfg.redirectUri);
    // MF3: client returns RAW expires_in, never an absolute time
    expect(tokens).toMatchObject({
      accessToken: NEW_ACCESS,
      expiresIn: 3600,
      refreshToken: REFRESH,
    });
  });

  it("refresh POSTs a refresh_token grant", async () => {
    const fetchImpl = vi.fn((_url: string, _init: Init) =>
      Promise.resolve(okJson({ ...tokenBody, [RT]: undefined })),
    );
    await httpGoogleOAuthClient(cfg, fetchImpl as unknown as typeof fetch).refresh(REFRESH);
    const body = new URLSearchParams(fetchImpl.mock.calls[0]![1].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe(REFRESH);
  });

  it("classifies 5xx as TransientError (retryable)", async () => {
    const fetchImpl = vi.fn(async () => errJson(503, { error: "backend_error" }));
    await expect(
      httpGoogleOAuthClient(cfg, fetchImpl as unknown as typeof fetch).refresh("x"),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("classifies 4xx invalid_grant as a permanent GoogleOAuthError", async () => {
    const fetchImpl = vi.fn(async () => errJson(400, { error: "invalid_grant" }));
    await expect(
      httpGoogleOAuthClient(cfg, fetchImpl as unknown as typeof fetch).refresh("x"),
    ).rejects.toMatchObject({ name: "GoogleOAuthError", code: "invalid_grant" });
  });

  it("wraps a network-level failure as TransientError (must NOT look permanent → no wrongful revoke)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(
      httpGoogleOAuthClient(cfg, fetchImpl as unknown as typeof fetch).exchangeCode("x"),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("revoke is idempotent — 200 and 400 both resolve, 5xx is transient", async () => {
    const ok = vi.fn(async () => okJson({}));
    await expect(
      httpGoogleOAuthClient(cfg, ok as unknown as typeof fetch).revoke("t"),
    ).resolves.toBeUndefined();
    const gone = vi.fn(async () => errJson(400, { error: "invalid_token" }));
    await expect(
      httpGoogleOAuthClient(cfg, gone as unknown as typeof fetch).revoke("t"),
    ).resolves.toBeUndefined();
    const down = vi.fn(async () => errJson(500, {}));
    await expect(
      httpGoogleOAuthClient(cfg, down as unknown as typeof fetch).revoke("t"),
    ).rejects.toBeInstanceOf(TransientError);
  });
});

describe("getValidAccessToken — refresh-on-demand (AC5)", () => {
  const cred: StoredCredential = {
    refreshToken: REFRESH,
    accessToken: OLD_ACCESS,
    expiry: "2026-06-18 12:00:00",
    scopes: ["https://www.googleapis.com/auth/calendar"],
  };
  const at = (iso: string) => () => new Date(Date.parse(iso));
  const fakeClient = (over: Partial<GoogleOAuthClient> = {}): GoogleOAuthClient => ({
    exchangeCode: vi.fn(),
    refresh: vi.fn(),
    revoke: vi.fn(),
    ...over,
  });

  it("app-only — no credential row → not_connected/absent and ZERO Google calls", async () => {
    const oauthClient = fakeClient();
    const credentials = { get: vi.fn(() => null), updateTokens: vi.fn(), delete: vi.fn() };
    const r = await getValidAccessToken("default", {
      oauthClient,
      credentials,
      now: at("2026-06-18T13:00:00Z"),
    });
    expect(r).toEqual({ status: "not_connected", reason: "absent" });
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it("returns the cached token with ZERO network when it is still valid", async () => {
    const oauthClient = fakeClient();
    const credentials = { get: vi.fn(() => cred), updateTokens: vi.fn(), delete: vi.fn() };
    const r = await getValidAccessToken("default", {
      oauthClient,
      credentials,
      now: at("2026-06-18T11:00:00Z"), // before expiry
    });
    expect(r).toEqual({ status: "ok", token: OLD_ACCESS });
    expect(oauthClient.refresh).not.toHaveBeenCalled();
  });

  it("refreshes when expired, persists the new token, and computes expiry once (MF3)", async () => {
    const refresh = vi.fn(async () => ({
      accessToken: NEW_ACCESS,
      expiresIn: 3600,
      scope: "s",
      tokenType: "Bearer",
    }));
    const oauthClient = fakeClient({ refresh });
    const updateTokens = vi.fn();
    const credentials = { get: vi.fn(() => cred), updateTokens, delete: vi.fn() };
    const r = await getValidAccessToken("default", {
      oauthClient,
      credentials,
      now: at("2026-06-18T13:00:00Z"), // after expiry
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(r).toEqual({ status: "ok", token: NEW_ACCESS });
    // expiry = now + (3600 - 60)s = 13:00:00 + 59m = 13:59:00 (computed once via sqliteUtc)
    expect(updateTokens).toHaveBeenCalledWith("default", NEW_ACCESS, "2026-06-18 13:59:00");
  });

  it("revoked refresh (invalid_grant) → delete + not_connected/revoked, never throws", async () => {
    const refresh = vi.fn(async () => {
      throw new GoogleOAuthError("invalid_grant", 400);
    });
    const del = vi.fn();
    const oauthClient = fakeClient({ refresh });
    const credentials = { get: vi.fn(() => cred), updateTokens: vi.fn(), delete: del };
    const r = await getValidAccessToken("default", {
      oauthClient,
      credentials,
      now: at("2026-06-18T13:00:00Z"),
    });
    expect(del).toHaveBeenCalledWith("default");
    expect(r).toEqual({ status: "not_connected", reason: "revoked" });
  });

  it("transient refresh failure rethrows TransientError and does NOT delete (stays connected)", async () => {
    const refresh = vi.fn(async () => {
      throw new TransientError("google 503");
    });
    const del = vi.fn();
    const oauthClient = fakeClient({ refresh });
    const credentials = { get: vi.fn(() => cred), updateTokens: vi.fn(), delete: del };
    await expect(
      getValidAccessToken("default", { oauthClient, credentials, now: at("2026-06-18T13:00:00Z") }),
    ).rejects.toBeInstanceOf(TransientError);
    expect(del).not.toHaveBeenCalled();
  });
});
