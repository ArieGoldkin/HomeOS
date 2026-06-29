import { randomBytes } from "node:crypto";
import { connectionStatusSchema } from "@homeos/shared";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { GoogleOAuthSettings } from "../../src/config.ts";
import { createCredentialStore } from "../../src/db/credential-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";
import { GOOGLE_SCOPES, type GoogleOAuthClient } from "../../src/google/oauth.ts";
import {
  buildGoogleDeps,
  type GoogleOAuthDeps,
  registerOAuthRoutes,
} from "../../src/http/oauth-routes/index.ts";
import { createRateLimiter } from "../../src/http/rate-limit.ts";
import { requireSession } from "../../src/http/session/index.ts";
import { type JwtKit, makeJwtKit } from "./session/jwt-test-kit.ts";

// #225/#231 — the shared ES256 JWT kit. status was session-gated by #225; #231 moves connect-url +
// disconnect behind the SAME `requireSession` guard. So every gated request mints a token with this kit
// (default email "dad@example.com", the harness allowlist), and the harness wires `requireSession` as
// registerOAuthRoutes's 3rd arg. The connect-initiator's {familyId, email} ride the single-use state;
// the callback (no session of its own) enforces connected-Google-email == that state email.
let kit: JwtKit;
beforeAll(async () => {
  kit = await makeJwtKit();
});

// A valid session header — default email "dad@example.com" (allowlisted), familyId falls back to the
// single FAMILY_ID. This is what the gated mutations now require (NOT a setup/admin bearer).
const sessionHeaders = async () => ({ authorization: `Bearer ${await kit.sign()}` });

const NEW_ACCESS = "access-new";
const REFRESH = "refresh-tok";
const CSEC = "csec-val";
const DAD = "dad@example.com"; // the harness session email the connect-url mints state with
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

function harness(over: Partial<GoogleOAuthDeps> = {}, opts: { session?: boolean } = {}) {
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
    now: fixedNow,
    ...over,
  };
  const app = new Hono();
  // #231 — the session middleware that gates status + connect-url + disconnect. `session: false` omits it
  // so those routes fall back to the dark 503 (the "auth not configured" path).
  const guard =
    opts.session === false ? undefined : requireSession(kit.sessionConfig(["dad@example.com"]));
  registerOAuthRoutes(app, deps, guard);
  return { app, client, credentials, events };
}

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
    expect((await app.request("/connect/google")).status).toBe(404);
    expect((await app.request("/disconnect/google", { method: "POST" })).status).toBe(404);
  });
});

describe("GET /oauth/google/connect-url (#108/#231 — session-gated)", () => {
  it("401s without a session / with a bad token and mints NO state row", async () => {
    const { app, credentials } = harness();
    // A known live row to compare against (issueState now carries the connect-initiator email).
    const before = credentials.issueState(FAMILY_ID, DAD);
    expect(credentials.consumeState(before)).toMatchObject({ familyId: FAMILY_ID, email: DAD });
    expect(
      (
        await app.request("/oauth/google/connect-url", {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
    expect((await app.request("/oauth/google/connect-url")).status).toBe(401);
    // An unauth probe must not have minted a consumable state row.
    expect(credentials.consumeState("anything")).toBeNull();
  });

  it("200 {url} with min scopes + a state for a valid session", async () => {
    const { app } = harness();
    const res = await app.request("/oauth/google/connect-url", { headers: await sessionHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const loc = new URL(body.url);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const scope = loc.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.readonly");
    expect(scope).toContain("calendar");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("429 (rate-limited) on a valid session", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, mismatchDelayMs: 0 });
    const { app } = harness({ rateLimiter: limiter });
    expect(
      (await app.request("/oauth/google/connect-url", { headers: await sessionHeaders() })).status,
    ).toBe(200);
    expect(
      (await app.request("/oauth/google/connect-url", { headers: await sessionHeaders() })).status,
    ).toBe(429);
  });
});

describe("GET /oauth/google/callback", () => {
  it("happy path: valid state → exchange → connected-email matches → stores + connected page", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
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
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    expect((await app.request(`/oauth/google/callback?code=C&state=${state}`)).status).toBe(200);
    expect((await app.request(`/oauth/google/callback?code=C&state=${state}`)).status).toBe(403);
  });

  it("no refresh_token in the response → 400, stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens({ refreshToken: undefined }));
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(400);
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("missing a required scope → 400 bad_scope (OG17), stores nothing", async () => {
    const exchangeCode = vi.fn(
      async () => tokens({ scope: "https://www.googleapis.com/auth/calendar" }), // gmail.readonly deselected
    );
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
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

describe("GET /oauth/google/callback — account pin (#231) + overwrite-guard (#109)", () => {
  it("connected account == the state email → upsert + connected", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("מחובר");
    expect(getEmail).toHaveBeenCalledWith(NEW_ACCESS);
    expect(credentials.get(FAMILY_ID)?.refreshToken).toBe(REFRESH);
  });

  it("the email match is case-insensitive (review N1)", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => "DAD@Example.COM"); // same address, different casing
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(200); // connected, not bad_account
    expect(credentials.get(FAMILY_ID)?.refreshToken).toBe(REFRESH);
  });

  it("connected account != the state email → bad_account (403), stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => "intruder@example.com");
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("חשבון לא תואם");
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("a state with a NULL email (predates the #231 column) → fail-closed refuse, stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    // Simulate a pre-migration row: the email column is nullable, so mint one with a null email. The
    // callback cannot verify which account this is, so it MUST refuse rather than connect the wrong one.
    const state = credentials.issueState(FAMILY_ID, null as unknown as string);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("חשבון לא תואם");
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });

  it("a present credential row + a new attempt → bad_account (no silent overwrite; pin never consulted)", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    // First connect succeeds.
    const s1 = credentials.issueState(FAMILY_ID, DAD);
    expect((await app.request(`/oauth/google/callback?code=C&state=${s1}`)).status).toBe(200);
    const firstRefresh = credentials.get(FAMILY_ID)?.refreshToken;
    // A second attempt is refused before any overwrite — the email pin is never even consulted.
    getEmail.mockClear();
    const s2 = credentials.issueState(FAMILY_ID, DAD);
    const res = await app.request(`/oauth/google/callback?code=C&state=${s2}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("חשבון לא תואם");
    expect(getEmail).not.toHaveBeenCalled();
    expect(credentials.get(FAMILY_ID)?.refreshToken).toBe(firstRefresh);
  });

  it("getEmail throwing → error outcome (502), stores nothing", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => {
      throw new Error("transient");
    });
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    const res = await app.request(`/oauth/google/callback?code=C&state=${state}`);
    expect(res.status).toBe(502);
    expect(credentials.get(FAMILY_ID)).toBeNull();
  });
});

describe("GET /oauth/google/callback — open-redirect-safe bounce (#109)", () => {
  const RETURN = "https://homeos-production-83a4.up.railway.app/connections";

  it("success → 302 to ?status=connected with Referrer-Policy and NO code/state/error", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({
      webReturnUrl: RETURN,
      client: fakeClient({ exchangeCode, getEmail }),
    });
    const state = credentials.issueState(FAMILY_ID, DAD);
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

describe("POST /oauth/google/disconnect (#108/#231 — session-gated)", () => {
  it("revokes at Google then deletes locally + purges (reversible, AC4) → {disconnected:true}", async () => {
    const revoke = vi.fn(async () => {});
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const deleteByProvider = vi.fn(() => 0);
    const { app, credentials } = harness({
      client: fakeClient({ exchangeCode, revoke, getEmail }),
      events: { deleteByProvider },
    });
    const state = credentials.issueState(FAMILY_ID, DAD);
    await app.request(`/oauth/google/callback?code=C&state=${state}`); // connect first
    expect(credentials.get(FAMILY_ID)).not.toBeNull();

    const res = await app.request("/oauth/google/disconnect", {
      method: "POST",
      headers: await sessionHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(revoke).toHaveBeenCalledWith(REFRESH);
    expect(credentials.get(FAMILY_ID)).toBeNull();
    expect(deleteByProvider).toHaveBeenCalledWith("google");
  });

  it("401s without a session token or with a bad one", async () => {
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

  it("503 when session is unconfigured (no guard wired)", async () => {
    const { app } = harness({}, { session: false });
    expect((await app.request("/oauth/google/disconnect", { method: "POST" })).status).toBe(503);
  });
});

describe("GET /oauth/google/status (#108/#225)", () => {
  it("401s without a session token, with an invalid one, or an empty Bearer", async () => {
    const { app } = harness();
    expect((await app.request("/oauth/google/status")).status).toBe(401);
    // An empty `Bearer ` header (empty token) must NOT bypass the gate.
    expect(
      (await app.request("/oauth/google/status", { headers: { authorization: "Bearer " } })).status,
    ).toBe(401);
    expect(
      (await app.request("/oauth/google/status", { headers: { authorization: "Bearer wrong" } }))
        .status,
    ).toBe(401);
  });

  it("403 for a valid session whose email is not allowlisted", async () => {
    const { app } = harness();
    const stranger = await kit.sign({ email: "stranger@example.com" });
    const res = await app.request("/oauth/google/status", {
      headers: { authorization: `Bearer ${stranger}` },
    });
    expect(res.status).toBe(403);
  });

  it("503 when the status route is session-unconfigured (no guard wired)", async () => {
    const { app } = harness({}, { session: false });
    const res = await app.request("/oauth/google/status");
    expect(res.status).toBe(503);
  });

  it("{connected:false} when no credential is stored", async () => {
    const { app } = harness();
    const res = await app.request("/oauth/google/status", {
      headers: { authorization: `Bearer ${await kit.sign()}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ connected: false });
    expect(connectionStatusSchema.parse(body)).toEqual({ connected: false });
  });

  it("{connected:true,scopes,expiresAt} with NO token material (OG3) when stored", async () => {
    const exchangeCode = vi.fn(async () => tokens());
    const getEmail = vi.fn(async () => DAD);
    const { app, credentials } = harness({ client: fakeClient({ exchangeCode, getEmail }) });
    const state = credentials.issueState(FAMILY_ID, DAD);
    await app.request(`/oauth/google/callback?code=C&state=${state}`); // connect first
    const res = await app.request("/oauth/google/status", {
      headers: { authorization: `Bearer ${await kit.sign()}` },
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

describe("buildGoogleDeps — derives webReturnUrl (#106/#231)", () => {
  const ENC = Buffer.alloc(32, 1);
  const baseSettings: GoogleOAuthSettings = {
    clientId: "gcid",
    clientSecret: CSEC,
    redirectUri: "https://example.test/oauth/google/callback",
    encKey: ENC,
  };
  const events = { deleteByProvider: vi.fn(() => 0) };

  it("derives webReturnUrl from webBaseUrl (appending /connections)", () => {
    const settings: GoogleOAuthSettings = {
      ...baseSettings,
      webBaseUrl: "https://homeos-production-83a4.up.railway.app",
    };
    const deps = buildGoogleDeps(settings, ":memory:", events);
    expect(deps.webReturnUrl).toBe("https://homeos-production-83a4.up.railway.app/connections");
  });

  it("leaves webReturnUrl undefined when webBaseUrl is unset (static-page mode)", () => {
    const deps = buildGoogleDeps(baseSettings, ":memory:", events);
    expect(deps.webReturnUrl).toBeUndefined();
  });
});
