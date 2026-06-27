import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";

/**
 * #225 — the minimal identity extracted from a verified Supabase session JWT. `family_id` is NOT here:
 * it stays `FAMILY_ID="default"` for this issue; the per-user→family resolve lands with #226.
 */
export interface SessionClaims {
  /** Supabase user id (the JWT `sub`). */
  userId: string;
  /** The user's email (the JWT `email` claim) — the key the {@link requireSession} allowlist gates on. */
  email: string;
}

/** A jose key resolver — prod uses {@link remoteJwks}; tests inject a local key set (`createLocalJWKSet`). */
export type KeyResolver = JWTVerifyGetKey;

export interface VerifyOptions {
  /** Expected issuer — `${SUPABASE_URL}/auth/v1`. */
  issuer: string;
  /** Expected audience — Supabase signs user sessions with `aud: "authenticated"`. */
  audience?: string;
}

/**
 * Build the production JWKS resolver: a cached, WebCrypto-backed verifier pointed at the project's
 * `.well-known/jwks.json`. `createRemoteJWKSet` fetches the JWKS ONCE and caches it (refetching only on
 * an unknown `kid` / key rotation), so verification is local with NO per-request Supabase round-trip —
 * the load-bearing #225 property (asymmetric ES256 keys make local verify possible).
 */
export function remoteJwks(supabaseUrl: string): KeyResolver {
  return createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
}

/**
 * Verify a Supabase access-token JWT LOCALLY against the JWKS. Returns the {@link SessionClaims} on
 * success, or `null` on ANY failure (bad signature, expired, wrong issuer/audience, missing sub/email,
 * malformed) — it never throws, so callers map `null` → 401 uniformly.
 *
 * `algorithms: ["ES256"]` is load-bearing: it pins asymmetric verification and REJECTS a legacy
 * symmetric `HS256` token, closing the algorithm-confusion door.
 */
export async function verifyAccessToken(
  jwt: string,
  getKey: KeyResolver,
  opts: VerifyOptions,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(jwt, getKey, {
      issuer: opts.issuer,
      audience: opts.audience ?? "authenticated",
      algorithms: ["ES256"],
    });
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email : "";
    if (!userId || !email) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
