import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type RequireSessionConfig,
  requireSession,
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

/** Build a tiny app whose `/protected` route echoes the session vars the middleware attaches. */
function makeApp(overrides: Partial<RequireSessionConfig> = {}) {
  const config: RequireSessionConfig = {
    getKey,
    verify: { issuer: ISS, audience: AUD },
    allowedEmails: new Set(["dad@example.com"]),
    ...overrides,
  };
  const app = new Hono<{ Variables: SessionVars }>();
  app.get("/protected", requireSession(config), (c) =>
    c.json({ userId: c.get("userId"), email: c.get("email") }),
  );
  return app;
}

describe("requireSession", () => {
  it("200 + attaches {userId,email} for a valid allowlisted Bearer token", async () => {
    const app = makeApp();
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-123", email: "dad@example.com" });
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
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer not.a.jwt" },
    });
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
    expect(await res.json()).toEqual({ userId: "user-123", email: "dad@example.com" });
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
