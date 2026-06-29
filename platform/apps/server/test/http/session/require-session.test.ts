import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type RequireSessionConfig,
  requireSession,
  requireWrite,
  type SessionVars,
} from "../../../src/http/session/require-session.ts";
import type { KeyResolver } from "../../../src/http/session/verify.ts";

const ISS = "https://test.supabase.co/auth/v1";
const AUD = "authenticated";

// jose's key type (the tsconfig lib doesn't expose the global `CryptoKey`); derive it from generateKeyPair.
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signKey: SigningKey;
let getKey: KeyResolver;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  const pubJwk = await exportJWK(kp.publicKey);
  pubJwk.kid = "test-key-1";
  pubJwk.alg = "ES256";
  pubJwk.use = "sig";
  signKey = kp.privateKey;
  getKey = createLocalJWKSet({ keys: [pubJwk] });
});

async function sign(
  o: { email?: string; expSec?: number; key?: SigningKey } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "user-123", email: o.email ?? "dad@example.com" })
    .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
    .setIssuedAt(now)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setExpirationTime(now + (o.expSec ?? 3600))
    .sign(o.key ?? signKey);
}

// #226 — config defaults: no member row (resolveMembership → null) so familyId/role take the N=1 fallbacks.
function makeConfig(overrides: Partial<RequireSessionConfig> = {}): RequireSessionConfig {
  return {
    getKey,
    verify: { issuer: ISS, audience: AUD },
    allowedEmails: new Set(["dad@example.com"]),
    resolveMembership: () => null,
    fallbackFamilyId: "default",
    defaultRole: "member",
    ...overrides,
  };
}

/** A `/protected` route that echoes ALL the session vars the middleware attaches (#226: incl familyId/role). */
function makeApp(overrides: Partial<RequireSessionConfig> = {}) {
  const app = new Hono<{ Variables: SessionVars }>();
  app.get("/protected", requireSession(makeConfig(overrides)), (c) =>
    c.json({
      userId: c.get("userId"),
      email: c.get("email"),
      familyId: c.get("familyId"),
      role: c.get("role"),
    }),
  );
  return app;
}

/** A write route gated by requireSession THEN requireWrite (#226 role gate). */
function makeWriteApp(overrides: Partial<RequireSessionConfig> = {}) {
  const app = new Hono<{ Variables: SessionVars }>();
  app.post("/write", requireSession(makeConfig(overrides)), requireWrite(), (c) =>
    c.json({ ok: true }),
  );
  return app;
}

describe("requireSession", () => {
  it("200 + attaches {userId,email,familyId,role} (N=1 fallbacks) for a valid allowlisted Bearer token", async () => {
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "user-123",
      email: "dad@example.com",
      familyId: "default",
      role: "member",
    });
  });

  it("attaches the DB membership {familyId,role} when resolveMembership finds a row (#226)", async () => {
    const app = makeApp({ resolveMembership: () => ({ familyId: "fam-x", role: "owner" }) });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(await res.json()).toMatchObject({ familyId: "fam-x", role: "owner" });
  });

  it("falls back to {FAMILY_ID, defaultRole} when the uid is not a member row yet (no lockout)", async () => {
    // resolveMembership → null (default): the N=1 reality until real-uid rows exist.
    const app = makeApp({ fallbackFamilyId: "default", defaultRole: "member" });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ familyId: "default", role: "member" });
  });

  it("403 for a valid token whose email is NOT allowlisted", async () => {
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign({ email: "stranger@example.com" })}` },
    });
    expect(res.status).toBe(403);
  });

  it("401 when no token is present", async () => {
    const res = await makeApp().request("/protected");
    expect(res.status).toBe(401);
  });

  it("401 for a malformed / unverifiable token", async () => {
    const app = makeApp();
    const res = await app.request("/protected", { headers: { authorization: "Bearer not.a.jwt" } });
    expect(res.status).toBe(401);
  });

  it("401 for an expired token", async () => {
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign({ expSec: -10 })}` },
    });
    expect(res.status).toBe(401);
  });

  it("reads the token from the cookie extractor when there is no Bearer header", async () => {
    const token = await sign();
    const app = makeApp({ extractCookieToken: () => token });
    const res = await app.request("/protected");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: "user-123", email: "dad@example.com" });
  });

  it("prefers the Bearer header over the cookie", async () => {
    const app = makeApp({ extractCookieToken: () => "cookie-garbage" });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
  });

  it("matches the allowlist case-insensitively", async () => {
    const app = makeApp({ allowedEmails: new Set(["dad@example.com"]) });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign({ email: "DAD@Example.com" })}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("requireWrite (#226 — role gate, not a second secret)", () => {
  it("passes a member (the N=1 default role) → 200", async () => {
    const res = await makeWriteApp().request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
  });

  it("passes an owner → 200", async () => {
    const app = makeWriteApp({ resolveMembership: () => ({ familyId: "default", role: "owner" }) });
    const res = await app.request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
  });

  it("403s a viewer (read-only role)", async () => {
    const app = makeWriteApp({
      resolveMembership: () => ({ familyId: "default", role: "viewer" }),
    });
    const res = await app.request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(403);
  });

  it("401 before the role check when there is no valid session (requireSession rejects first)", async () => {
    const res = await makeWriteApp().request("/write", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
