import { randomBytes } from "node:crypto";
import { connectionStatusSchema } from "@homeos/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { GoogleOAuthSettings } from "../../src/config.ts";
import { createCredentialStore } from "../../src/db/credential-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";
import { GOOGLE_SCOPES, type GoogleOAuthClient } from "../../src/google/oauth.ts";
import {
  buildGoogleDeps,
  type GoogleOAuthDeps,
  gateMatches,
  registerOAuthRoutes,
} from "../../src/http/oauth-routes.ts";
import { createRateLimiter } from "../../src/http/rate-limit.ts";

const ADMIN = "admin-tok";
const NEW_ACCESS = "access-new";
const REFRESH = "refresh-tok";
const CSEC = "csec-val";
const key = randomBytes(32);
const cfg = {
  clientId: "gcid",
  clientSecret: CSEC,
  redirectUri: "https://example.test/oauth/google/callback",
};
const fixedNow = () => new Date("2026-06-18T12:00:00Z");

const fakeClient = (over: Partial<GoogleOAuthClient> = {}): GoogleOAuthClient => ({
  exchangeCode: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
  getEmail: vi.fn(),
  ...over,
});

const tokens = (over: Record<string, unknown> = {}) => ({
  accessToken: NEW_ACCESS,
  expiresIn: 3600,
  refreshToken: REFRESH,
  scope: GOOGLE_SCOPES.join(" "),
  tokenType: "Bearer",
  ...over,
});

function harness(over: Partial<GoogleOAuthDeps> = {}) {
  const credentials = createCredentialStore(":memory:", key, fixedNow);
  const client = over.client ?? fakeClient();
  const events = over.events ?? {
    deleteByProvider: vi.fn(() => 0),
    deleteById: vi.fn(() => 1),
    findEventsByRef: vi.fn(() => []),
    updateEvent: vi.fn(() => null),
  };
  const deps: GoogleOAuthDeps = {
    client,
    credentials,
    events,
    config: cfg,
    adminToken: ADMIN,
    now: fixedNow,
    ...over,
  };
  const app = new Hono();
  registerOAuthRoutes(app, deps);
  return { app, client, credentials, events };
}

const auth = { authorization: `Bearer ${ADMIN}` };

describe("OAuth routes — ships dark", () => {
  it("returns 503 on every route when no Google deps are configured", async () => {
    const app = new Hono();
    registerOAuthRoutes(app); // undefined deps
    expect((await app.request("/oauth/google/callback?code=x&state=y")).status).toBe(503);
    expect((await app.request("/oauth/google/status")).status).toBe(503);
    expect((await app.request("/oauth/google/connect-url")).status).toBe(503);
    expect((await app.request("/oauth/google/disconnect", { method: "POST" })).status).toBe(503);
  });

  it("the legacy routes are gone (404)", async () => {
    const { app } = harness();
    expect((await app.request("/connect/google", { headers: auth })).status).toBe(404);
    expect(
      (await app.request("/disconnect/google", { method: "POST", headers: auth })).status,
    ).toBe(404);
  });
});

describe("GET /oauth/google/connect-url (#108)", () => {
  it("401s without a valid gate bearer and mints NO state row", async () => {
    const { app, credentials } = harness();
    const before = credentials.issueState(FAMILY_ID); // a known live row to compare against
    expect(credentials.consumeState(before, FAMILY_ID)).toBe(true);
    expect(
      (
        await app.request("/oauth/google/connect-url", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    expect((await app.request("/oauth/google/connect-url")).status).toBe(401);
    // An unauth probe must not have minted a consumable state row.
    expect(credentials.consumeState("anything", FAMILY_ID)).toBe(false);
  });

  it("200 {url} with min scopes + a state for a valid admin bearer (curl escape hatch)", async () => {
    const { app } = harness();
    const res = await app.request("/oauth/google/connect-url", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const loc = new URL(body.url);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const scope = loc.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.readonly");
    expect(scope).toContain("calendar");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("200 for a valid SETUP_TOKEN bearer too", async () => {
    const SETUP = "setup-tok";
    const { app } = harness({ setupToken: SETUP });
    const res = await app.request("/oauth/google/connect-url", {
      headers: { authorization: `Bearer ${SETUP}` },
    });
    expect(res.status).toBe(200);
  });

  it("429 (rate-limited) before the gate check", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, mismatchDelayMs: 0 });
    const { app } = harness({ rateLimiter: limiter });
    expect((await app.request("/oauth/google/connect-url", { headers: auth })).status).toBe(200);
    expect((await app.request("/oauth/google/connect-url", { headers: auth })).status).toBe(429);
  });
});

describe("GET /oauth/google/callback", () => {
  it("happy path: valid state → exchange → stores encrypted credential → connected page", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode }) });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=CODE&state=${state}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("מחובר");
    expect(exchangeCode).toHaveBeenCalledWith("CODE");
    const stored = credentials.get(FAMILY_ID);
    expect(stored?.refreshToken).toBe(REFRESH);
    expect(stored?.expiry).toBe("2026-06-18 12:59:00"); // now + (3600-60)s, MF3
  });

  it("error=access_denied → cancelled page, NO token exchange", async () => {
    const exchangeCode = vi.fn();
    const { app } = harness({ client: fakeClient({ exchangeCode }) });
    const res = await app.request("/oauth/google/callback?error=access_denied");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("בוטל");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("invalid/forged state → 403, NO token exchange", async () => {
    const exchangeCode = vi.fn();
    const { app } = harness({ client: fakeClient({ exchangeCode }) });
    const res = await app.request("/oauth/google/callback?code=CODE&state=forged");
    expect(res.status).toBe(403);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("reused state → 403 the second time (single-use)", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode }) });
    const state = credentials.issueState(FAMILY_ID);
    expect((await app.request(`/oauth/google/callback?code=C&state=${state}`)).status).toBe(200);
    expect((await app.request(`/oauth/google/callback?code=C&state=${state}`)).status).toBe(403);
  });

  it("no refresh_token in the response → 400, stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens({ refreshToken: undefined }));
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode }) });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(400);
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("missing a required scope → 400 bad_scope (OG17), stores nothing", async () => {
    const exchangeCode = vi.fn(
      async () => tokens({ scope: "https://www.googleapis.com/auth/calendar" }), // gmail.readonly deselected
    );
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode }) });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(400);
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("does NOT reflect a hostile error param (OG16 — static page only)", async () => {
    const { app } = harness();
    const res = await app.request("/oauth/google/callback?error=%3Cscript%3Ealert(1)%3C/script%3E");
    const body = await res.text();
    expect(body).not.toContain("<script>");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  });
});

describe("GET /oauth/google/callback — account pin + overwrite-guard (#109)", () => {
  const ALLOWED = "fam@example.test";

  it("allowedEmail set + matching account → upsert + connected", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => ALLOWED);
    const { app, credentials } = harness({
      allowedEmail: ALLOWED,
      client: fakeClient({ exchangeCode, getEmail }),
    });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("מחובר");
    expect(getEmail).toHaveBeenCalledWith(NEW_ACCESS);
    expect(credentials.get(FAMILY_ID)?.refreshToken).toBe(REFRESH);
  });

  it("allowedEmail set + mismatched account → bad_account (403), stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => "intruder@example.test");
    const { app, credentials } = harness({
      allowedEmail: ALLOWED,
      client: fakeClient({ exchangeCode, getEmail }),
    });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("חשבון לא תואם");
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("a present credential row + a new attempt → bad_account (no silent overwrite)", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => ALLOWED);
    const { app, credentials } = harness({
      allowedEmail: ALLOWED,
      client: fakeClient({ exchangeCode, getEmail }),
    });
    // First connect succeeds.
    const s1 = credentials.issueState(FAMILY_ID);
    expect((await app.request(`/oauth/google/callback?code=C&state=${s1}`)).status).toBe(200);
    const firstRefresh = credentials.get(FAMILY_ID)?.refreshToken;
    // A second attempt is refused before any overwrite — the pin is never even consulted.
    getEmail.mockClear();
    const s2 = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=C&state=${s2}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("חשבון לא תואם");
    expect(getEmail).not.toHaveBeenCalled();
    expect(credentials.get(FAMILY_ID)?.refreshToken).toBe(firstRefresh);
  });

  it("getEmail throwing → error outcome, stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => {
      throw new Error("transient");
    });
    const { app, credentials } = harness({
      allowedEmail: ALLOWED,
      client: fakeClient({ exchangeCode, getEmail }),
    });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(502);
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("allowedEmail UNSET → admin-only mode, no pin (getEmail never called)", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => ALLOWED);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID);
    expect((await app.request(`/oauth/google/callback?code=C&state=${state}`)).status).toBe(200);
    expect(getEmail).not.toHaveBeenCalled();
    expect(credentials.get(FAMILY_ID)?.refreshToken).toBe(REFRESH);
  });
});

describe("GET /oauth/google/callback — open-redirect-safe bounce (#109)", () => {
  const RETURN = "https://homeos-production-83a4.up.railway.app/connections";

  it("success → 302 to ?status=connected with Referrer-Policy and NO code/state/error", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const { app, credentials } = harness({
      webReturnUrl: RETURN,
      client: fakeClient({ exchangeCode }),
    });
    const state = credentials.issueState(FAMILY_ID);
    const res = await app.request(`/oauth/google/callback?code=SECRET_CODE&state=${state}`);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toBe(`${RETURN}?status=connected`);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(loc).not.toContain("SECRET_CODE");
    expect(loc).not.toContain("code=");
    expect(loc).not.toContain("state=");
    expect(loc).not.toContain("error=");
  });

  it("error=access_denied → 302 to ?status=cancelled (no exchange)", async () => {
    const exchangeCode = vi.fn();
    const { app } = harness({ webReturnUrl: RETURN, client: fakeClient({ exchangeCode }) });
    const res = await app.request("/oauth/google/callback?error=access_denied");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${RETURN}?status=cancelled`);
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});

describe("POST /oauth/google/disconnect (#108)", () => {
  it("revokes at Google then deletes locally + purges (reversible, AC4) → {disconnected:true}", async () => {
    const revoke = vi.fn(async () => {});
    const exchangeCode = vi.fn(async () => tokens());
    const deleteByProvider = vi.fn(() => 0);
    const { app, credentials } = harness({
      client: fakeClient({ exchangeCode, revoke }),
      events: { deleteByProvider },
    });
    const state = credentials.issueState(FAMILY_ID);
    await app.request(`/oauth/google/callback?code=C&state=${state}`); // connect first
    expect(credentials.get(FAMILY_ID)).not.toBeNull();

    const res = await app.request("/oauth/google/disconnect", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(revoke).toHaveBeenCalledWith(REFRESH);
    expect(credentials.get(FAMILY_ID)).toBeNull();
    expect(deleteByProvider).toHaveBeenCalledWith("google");
  });

  it("a valid SETUP_TOKEN bearer disconnects too (the gate, not admin-only)", async () => {
    const SETUP = "setup-tok";
    const { app } = harness({
      setupToken: SETUP,
      client: fakeClient({ revoke: vi.fn(async () => {}) }),
    });
    const res = await app.request("/oauth/google/disconnect", {
      method: "POST",
      headers: { authorization: `Bearer ${SETUP}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s without a valid gate bearer", async () => {
    const { app } = harness();
    expect((await app.request("/oauth/google/disconnect", { method: "POST" })).status).toBe(401);
    expect(
      (
        await app.request("/oauth/google/disconnect", {
          method: "POST",
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });
});

describe("GET /oauth/google/status (#108)", () => {
  const READ = "read-tok";

  it("401s when the read token is wrong or unset", async () => {
    const { app: noReadToken } = harness(); // readToken unset
    expect((await noReadToken.request("/oauth/google/status")).status).toBe(401);
    // readToken unset must NOT be bypassable with an empty `Bearer ` header (timingSafeEqual([],[])).
    expect(
      (await noReadToken.request("/oauth/google/status", { headers: { authorization: "Bearer " } }))
        .status,
    ).toBe(401);
    const { app } = harness({ readToken: READ });
    expect(
      (await app.request("/oauth/google/status", { headers: { authorization: "Bearer wrong" } }))
        .status,
    ).toBe(401);
  });

  it("{connected:false} when no credential is stored", async () => {
    const { app } = harness({ readToken: READ });
    const res = await app.request("/oauth/google/status", {
      headers: { authorization: `Bearer ${READ}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ connected: false });
    expect(connectionStatusSchema.parse(body)).toEqual({ connected: false });
  });

  it("{connected:true,scopes,expiresAt} with NO token material (OG3) when stored", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const { app, credentials } = harness({
      readToken: READ,
      client: fakeClient({ exchangeCode }),
    });
    const state = credentials.issueState(FAMILY_ID);
    await app.request(`/oauth/google/callback?code=C&state=${state}`); // connect first
    const res = await app.request("/oauth/google/status", {
      headers: { authorization: `Bearer ${READ}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Strict shared schema — fails loudly on any extra field (e.g. a leaked token).
    const parsed = connectionStatusSchema.parse(body);
    expect(parsed).toEqual({
      connected: true,
      scopes: GOOGLE_SCOPES,
      expiresAt: "2026-06-18 12:59:00",
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(REFRESH);
    expect(raw).not.toContain(NEW_ACCESS);
  });
});

describe("gateMatches — dual-token gate (#107)", () => {
  const SETUP = "setup-tok";
  const deps = { setupToken: SETUP, adminToken: ADMIN } as GoogleOAuthDeps;

  it("true for a valid SETUP_TOKEN bearer", () => {
    expect(gateMatches(`Bearer ${SETUP}`, deps)).toBe(true);
  });

  it("true for a valid ADMIN_TOKEN bearer (the curl escape hatch)", () => {
    expect(gateMatches(`Bearer ${ADMIN}`, deps)).toBe(true);
  });

  it("false for an absent or wrong bearer", () => {
    expect(gateMatches(undefined, deps)).toBe(false);
    expect(gateMatches("Bearer nope", deps)).toBe(false);
  });

  it("false when SETUP_TOKEN is unset and the bearer isn't the admin token", () => {
    expect(gateMatches("Bearer nope", { adminToken: ADMIN } as GoogleOAuthDeps)).toBe(false);
  });

  it("an empty-value bearer never passes when SETUP_TOKEN is unset", () => {
    // "Bearer " (trailing space, empty value) must NOT match an absent setup token.
    expect(gateMatches("Bearer ", { adminToken: ADMIN } as GoogleOAuthDeps)).toBe(false);
  });
});

describe("buildGoogleDeps — threads the self-serve optionals (#106)", () => {
  const ENC = Buffer.alloc(32, 1);
  const baseSettings: GoogleOAuthSettings = {
    clientId: "gcid",
    clientSecret: CSEC,
    redirectUri: "https://example.test/oauth/google/callback",
    encKey: ENC,
    adminToken: ADMIN,
  };
  const events = { deleteByProvider: vi.fn(() => 0) };

  it("derives webReturnUrl from webBaseUrl and threads setupToken / allowedEmail / readToken", () => {
    const settings: GoogleOAuthSettings = {
      ...baseSettings,
      setupToken: "setup-tok",
      webBaseUrl: "https://homeos-production-83a4.up.railway.app",
      allowedEmail: "parent@example.com",
    };
    const deps = buildGoogleDeps(settings, ":memory:", events, "read-tok");
    expect(deps.setupToken).toBe("setup-tok");
    expect(deps.allowedEmail).toBe("parent@example.com");
    expect(deps.readToken).toBe("read-tok");
    expect(deps.webReturnUrl).toBe("https://homeos-production-83a4.up.railway.app/connections");
  });

  it("leaves webReturnUrl undefined when webBaseUrl is unset (admin-only mode)", () => {
    const deps = buildGoogleDeps(baseSettings, ":memory:", events);
    expect(deps.webReturnUrl).toBeUndefined();
    expect(deps.setupToken).toBeUndefined();
    expect(deps.allowedEmail).toBeUndefined();
    expect(deps.readToken).toBeUndefined();
  });
});
