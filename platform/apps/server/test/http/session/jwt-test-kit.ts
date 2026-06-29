// Shared JWT signing kit for the #225 session-auth tests (NOT a .test.ts file, so vitest doesn't run it
// as a suite — it's imported by server.test.ts / oauth-routes.test.ts / require-session.test.ts). It mints
// ES256 tokens signed by a local keypair whose public half is exposed via a local JWKS resolver, so
// requireSession verifies them with ZERO network. Mirrors the real Supabase claim shape (sub + email,
// iss `${url}/auth/v1`, aud "authenticated").
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { KeyResolver, RequireSessionConfig } from "../../../src/http/session/index.ts";

export const TEST_ISS = "https://test.supabase.co/auth/v1";
export const TEST_AUD = "authenticated";

export interface JwtKit {
  /** Local JWKS resolver to pass as requireSession's `getKey`. */
  getKey: KeyResolver;
  /** Mint a signed session token. Defaults: sub "user-123", email "dad@example.com", 1h expiry. */
  sign(opts?: { email?: string; sub?: string; expSec?: number }): Promise<string>;
  /**
   * A ready RequireSessionConfig over `getKey` with the given allowlist (lower-cased). #226: pass
   * `resolveMembership` to drive familyId/role; default → null, so the N=1 fallbacks (default/member) apply.
   */
  sessionConfig(
    allowedEmails: Iterable<string>,
    opts?: { resolveMembership?: (userId: string) => { familyId: string; role: string } | null },
  ): RequireSessionConfig;
}

/** Build a fresh signing kit (call once in a `beforeAll`). */
export async function makeJwtKit(): Promise<JwtKit> {
  const kp = await generateKeyPair("ES256");
  const pubJwk = await exportJWK(kp.publicKey);
  pubJwk.kid = "test-key-1";
  pubJwk.alg = "ES256";
  pubJwk.use = "sig";
  const getKey = createLocalJWKSet({ keys: [pubJwk] });

  const sign: JwtKit["sign"] = (o = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: o.sub ?? "user-123", email: o.email ?? "dad@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
      .setIssuedAt(now)
      .setIssuer(TEST_ISS)
      .setAudience(TEST_AUD)
      .setExpirationTime(now + (o.expSec ?? 3600))
      .sign(kp.privateKey);
  };

  const sessionConfig: JwtKit["sessionConfig"] = (allowedEmails, opts = {}) => ({
    getKey,
    verify: { issuer: TEST_ISS, audience: TEST_AUD },
    allowedEmails: new Set([...allowedEmails].map((e) => e.toLowerCase())),
    resolveMembership: opts.resolveMembership ?? (() => null),
    fallbackFamilyId: "default",
    defaultRole: "member",
  });

  return { getKey, sign, sessionConfig };
}
