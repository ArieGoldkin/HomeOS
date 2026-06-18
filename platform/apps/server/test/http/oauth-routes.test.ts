import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createCredentialStore } from "../../src/db/credential-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";
import { GOOGLE_SCOPES, type GoogleOAuthClient } from "../../src/google/oauth.ts";
import { type GoogleOAuthDeps, registerOAuthRoutes } from "../../src/http/oauth-routes.ts";

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
  const events = over.events ?? { deleteByProvider: vi.fn(() => 0) };
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
    expect((await app.request("/connect/google")).status).toBe(503);
    expect((await app.request("/oauth/google/callback?code=x&state=y")).status).toBe(503);
    expect((await app.request("/disconnect/google", { method: "POST" })).status).toBe(503);
  });
});

describe("GET /connect/google", () => {
  it("401s without the admin bearer", async () => {
    const { app } = harness();
    expect((await app.request("/connect/google")).status).toBe(401);
    expect(
      (await app.request("/connect/google", { headers: { authorization: "Bearer wrong" } })).status,
    ).toBe(401);
  });

  it("302s to Google's consent screen with min scopes + a state", async () => {
    const { app } = harness();
    const res = await app.request("/connect/google", { headers: auth });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("scope")).toContain("gmail.readonly");
    expect(loc.searchParams.get("state")).toBeTruthy();
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

describe("POST /disconnect/google", () => {
  it("revokes at Google then deletes locally (reversible, AC4)", async () => {
    const revoke = vi.fn(async () => {});
    const exchangeCode = vi.fn(async () => tokens());
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, revoke }) });
    const state = credentials.issueState(FAMILY_ID);
    await app.request(`/oauth/google/callback?code=C&state=${state}`); // connect first
    expect(credentials.get(FAMILY_ID)).not.toBeNull();

    const res = await app.request("/disconnect/google", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(REFRESH);
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("purges provider-derived rows on disconnect (#61/MF5)", async () => {
    const deleteByProvider = vi.fn(() => 0);
    const { app } = harness({
      client: fakeClient({ revoke: vi.fn(async () => {}) }),
      events: { deleteByProvider },
    });
    await app.request("/disconnect/google", { method: "POST", headers: auth });
    expect(deleteByProvider).toHaveBeenCalledWith("google");
  });

  it("401s without the admin bearer", async () => {
    const { app } = harness();
    expect((await app.request("/disconnect/google", { method: "POST" })).status).toBe(401);
  });
});
