import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type RequireSessionConfig,
  requireOwner,
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

// #226 — config defaults: no member row (resolveMembershipByEmail → null) so familyId/role take the N=1 fallbacks.
function makeConfig(overrides: Partial<RequireSessionConfig> = {}): RequireSessionConfig {
  return {
    getKey,
    verify: { issuer: ISS, audience: AUD },
    allowedEmails: new Set(["dad@example.com"]),
    resolveMembershipByEmail: () => null,
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

  it("attaches the DB membership {familyId,role} when resolveMembershipByEmail finds a row (#226)", async () => {
    const app = makeApp({ resolveMembershipByEmail: () => ({ familyId: "fam-x", role: "owner" }) });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(await res.json()).toMatchObject({ familyId: "fam-x", role: "owner" });
  });

  it("resolves membership by the session's EMAIL, not the uid (uid↔member binding)", async () => {
    // The placeholder user_id never equals the real auth.uid, so membership keys on the verified email.
    const seen: string[] = [];
    const app = makeApp({
      resolveMembershipByEmail: (email) => {
        seen.push(email);
        return email === "dad@example.com" ? { familyId: "fam-dad", role: "owner" } : null;
      },
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` }, // default token email = dad@example.com
    });
    expect(seen).toEqual(["dad@example.com"]); // the EMAIL was passed, not "user-123" (the sub/uid)
    expect(await res.json()).toMatchObject({ familyId: "fam-dad", role: "owner" });
  });

  it("falls back to {FAMILY_ID, defaultRole} when no member carries this email yet (no lockout)", async () => {
    // resolveMembershipByEmail → null (default): the N=1 reality until member emails are seeded.
    const app = makeApp({ fallbackFamilyId: "default", defaultRole: "member" });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ familyId: "default", role: "member" });
  });

  it("#260 — admits a member whose email is NOT on the static allowlist (the Slice 2 invite path)", async () => {
    // Break-glass goal: an invited user has a family_members row but is NOT in ALLOWED_LOGIN_EMAILS, and must
    // still be admitted with the row's {familyId, role} — membership is now a sufficient admission path.
    const app = makeApp({
      allowedEmails: new Set(), // empty static floor → admission can ONLY come from membership here
      resolveMembershipByEmail: (email) =>
        email === "dad@example.com" ? { familyId: "fam-invited", role: "member" } : null,
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` }, // dad@example.com
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ familyId: "fam-invited", role: "member" });
  });

  it("#260 — 403 when NEITHER a member row NOR the allowlist admits", async () => {
    const app = makeApp({ allowedEmails: new Set(), resolveMembershipByEmail: () => null });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(403);
  });

  it("#250 — claims a pending invite for a NOVEL email and admits with the invite's {familyId, role}", async () => {
    // Not a returning member, not on the floor → the claim branch fires and admits.
    const seen: Array<{ email: string; userId: string }> = [];
    const app = makeApp({
      allowedEmails: new Set(),
      resolveMembershipByEmail: () => null,
      claimInvite: (p) => {
        seen.push(p);
        return p.email === "dad@example.com" ? { familyId: "fam-invited", role: "viewer" } : null;
      },
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` }, // dad@example.com / sub user-123
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ email: "dad@example.com", userId: "user-123" }]); // email + real uid passed
    expect(await res.json()).toMatchObject({ familyId: "fam-invited", role: "viewer" });
  });

  it("#250 — 403 when there is no pending invite to claim (claimInvite → null)", async () => {
    const app = makeApp({
      allowedEmails: new Set(),
      resolveMembershipByEmail: () => null,
      claimInvite: () => null, // no pending invite for this email
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(403);
  });

  it("#250 — a returning member NEVER triggers a claim (fast path wins)", async () => {
    const claimInvite = vi.fn(() => null);
    const app = makeApp({
      resolveMembershipByEmail: () => ({ familyId: "fam-x", role: "member" }),
      claimInvite,
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(claimInvite).not.toHaveBeenCalled(); // membership resolved → claim branch skipped
  });

  it("#250 — an allowlisted user with no member row NEVER triggers a claim (floor wins, N=1 fallback)", async () => {
    const claimInvite = vi.fn(() => null);
    const app = makeApp({
      allowedEmails: new Set(["dad@example.com"]),
      resolveMembershipByEmail: () => null,
      claimInvite,
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(claimInvite).not.toHaveBeenCalled(); // on the floor → admitted without claiming
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

  it("#266 — reconciles an admitted member's placeholder uid to the real session uid (family+email)", async () => {
    const seen: Array<{ familyId: string; email: string; userId: string }> = [];
    const app = makeApp({
      resolveMembershipByEmail: () => ({ familyId: "fam-x", role: "owner" }),
      reconcileMemberUid: (m) => seen.push(m),
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` }, // sub user-123 / dad@example.com
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([{ familyId: "fam-x", email: "dad@example.com", userId: "user-123" }]);
  });

  it("#266 — does NOT reconcile when admission falls to the floor (no member row to upgrade)", async () => {
    const reconcile = vi.fn();
    const app = makeApp({
      allowedEmails: new Set(["dad@example.com"]),
      resolveMembershipByEmail: () => null, // floor admits; resolved stays null → nothing to reconcile
      reconcileMemberUid: reconcile,
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("#266 — FAIL-OPEN: a reconcile error never blocks an already-admitted session", async () => {
    const app = makeApp({
      resolveMembershipByEmail: () => ({ familyId: "fam-x", role: "owner" }),
      reconcileMemberUid: () => {
        throw new Error("db write failed");
      },
    });
    const res = await app.request("/protected", {
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200); // admitted despite the reconcile throw
    expect(await res.json()).toMatchObject({ familyId: "fam-x", role: "owner" });
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
    const app = makeWriteApp({
      resolveMembershipByEmail: () => ({ familyId: "default", role: "owner" }),
    });
    const res = await app.request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
  });

  it("403s a viewer (read-only role)", async () => {
    const app = makeWriteApp({
      resolveMembershipByEmail: () => ({ familyId: "default", role: "viewer" }),
    });
    const res = await app.request("/write", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s an unknown / mistyped role (fail-closed allow-list, #226)", async () => {
    const app = makeWriteApp({
      resolveMembershipByEmail: () => ({ familyId: "default", role: "guest" }),
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

describe("requireOwner (#250 — owner-only invite admin gate)", () => {
  function makeOwnerApp(overrides: Partial<RequireSessionConfig> = {}) {
    const app = new Hono<{ Variables: SessionVars }>();
    app.post("/invites", requireSession(makeConfig(overrides)), requireOwner(), (c) =>
      c.json({ ok: true }),
    );
    return app;
  }

  it("passes an owner → 200", async () => {
    const app = makeOwnerApp({
      resolveMembershipByEmail: () => ({ familyId: "default", role: "owner" }),
    });
    const res = await app.request("/invites", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(200);
  });

  it("403s a member (a writer, but NOT an owner — narrower than requireWrite)", async () => {
    // The N=1 default role is `member`, which writes via requireWrite — but must NOT mint invites.
    const res = await makeOwnerApp().request("/invites", {
      method: "POST",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s a viewer and an unknown role (fail-closed)", async () => {
    for (const role of ["viewer", "guest"]) {
      const app = makeOwnerApp({ resolveMembershipByEmail: () => ({ familyId: "default", role }) });
      const res = await app.request("/invites", {
        method: "POST",
        headers: { authorization: `Bearer ${await sign()}` },
      });
      expect(res.status).toBe(403);
    }
  });

  it("401 before the owner check when there is no valid session (requireSession rejects first)", async () => {
    const res = await makeOwnerApp().request("/invites", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
