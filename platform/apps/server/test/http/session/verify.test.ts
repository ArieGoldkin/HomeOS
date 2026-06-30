import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type KeyResolver,
  type VerifyOptions,
  verifyAccessToken,
} from "../../../src/http/session/verify.ts";

const ISS = "https://test.supabase.co/auth/v1";
const AUD = "authenticated";
const OPTS: VerifyOptions = { issuer: ISS, audience: AUD };

// jose's key type (the tsconfig lib doesn't expose the global `CryptoKey`); derive it from generateKeyPair.
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let signKey: SigningKey; // private key whose public half IS in the JWKS
let otherKey: SigningKey; // private key NOT in the JWKS (bad-signature case)
let getKey: KeyResolver; // local JWKS resolver over the matching public key

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  const pubJwk = await exportJWK(kp.publicKey);
  pubJwk.kid = "test-key-1";
  pubJwk.alg = "ES256";
  pubJwk.use = "sig";
  signKey = kp.privateKey;
  getKey = createLocalJWKSet({ keys: [pubJwk] });
  otherKey = (await generateKeyPair("ES256")).privateKey;
});

/** Sign a Supabase-shaped session JWT; every field has a valid default so each test overrides ONE thing. */
async function sign(
  o: {
    key?: SigningKey | Uint8Array;
    kid?: string;
    alg?: string;
    iss?: string;
    aud?: string;
    expSec?: number; // expiry RELATIVE to now (negative ⇒ already expired)
    sub?: string | null; // null ⇒ omit the claim
    email?: string | null; // null ⇒ omit the claim
    emailVerified?: boolean; // undefined ⇒ omit the top-level claim
    userMetadata?: Record<string, unknown>; // undefined ⇒ omit the nested object
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {};
  const sub = o.sub === undefined ? "user-123" : o.sub;
  const email = o.email === undefined ? "dad@example.com" : o.email;
  if (sub !== null) payload.sub = sub;
  if (email !== null) payload.email = email;
  if (o.emailVerified !== undefined) payload.email_verified = o.emailVerified;
  if (o.userMetadata !== undefined) payload.user_metadata = o.userMetadata;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: o.alg ?? "ES256", kid: o.kid ?? "test-key-1" })
    .setIssuedAt(now)
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? AUD)
    .setExpirationTime(now + (o.expSec ?? 3600))
    .sign(o.key ?? signKey);
}

describe("verifyAccessToken", () => {
  it("returns {userId,email} for a valid token", async () => {
    const t = await sign();
    expect(await verifyAccessToken(t, getKey, OPTS)).toEqual({
      userId: "user-123",
      email: "dad@example.com",
    });
  });

  it("rejects an expired token", async () => {
    const t = await sign({ expSec: -10 });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a wrong issuer", async () => {
    const t = await sign({ iss: "https://evil.supabase.co/auth/v1" });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a wrong audience", async () => {
    const t = await sign({ aud: "anon" });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a bad signature (key not in the JWKS)", async () => {
    const t = await sign({ key: otherKey });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a token missing the email claim", async () => {
    const t = await sign({ email: null });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a token missing the sub claim", async () => {
    const t = await sign({ sub: null });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a legacy symmetric HS256 token (alg-confusion guard)", async () => {
    const t = await sign({
      alg: "HS256",
      key: new TextEncoder().encode("a-symmetric-shared-key-32bytes!!"),
    });
    expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
  });

  it("rejects a malformed token string", async () => {
    expect(await verifyAccessToken("not.a.jwt", getKey, OPTS)).toBeNull();
    expect(await verifyAccessToken("", getKey, OPTS)).toBeNull();
  });

  it("defaults the audience to 'authenticated' when not specified", async () => {
    const t = await sign();
    expect(await verifyAccessToken(t, getKey, { issuer: ISS })).toEqual({
      userId: "user-123",
      email: "dad@example.com",
    });
  });

  describe("#250 — email_verified assertion (defense-in-depth, reject-on-explicit-false)", () => {
    it("admits a token whose email_verified is true (top-level)", async () => {
      const t = await sign({ emailVerified: true });
      expect(await verifyAccessToken(t, getKey, OPTS)).toMatchObject({ email: "dad@example.com" });
    });

    it("admits a Google-shaped token (user_metadata.email_verified: true)", async () => {
      const t = await sign({ userMetadata: { email_verified: true, full_name: "Dad" } });
      expect(await verifyAccessToken(t, getKey, OPTS)).toMatchObject({ email: "dad@example.com" });
    });

    it("admits a token that OMITS email_verified (no-lockout: absent ≠ unverified)", async () => {
      const t = await sign(); // neither top-level nor nested flag
      expect(await verifyAccessToken(t, getKey, OPTS)).toMatchObject({ email: "dad@example.com" });
    });

    it("REJECTS a token whose email_verified is explicitly false (top-level)", async () => {
      const t = await sign({ emailVerified: false });
      expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
    });

    it("REJECTS a token whose user_metadata.email_verified is explicitly false", async () => {
      const t = await sign({ userMetadata: { email_verified: false } });
      expect(await verifyAccessToken(t, getKey, OPTS)).toBeNull();
    });
  });
});
