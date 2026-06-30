// #225 — session auth (public surface). The Hono server gates its read/write routes with
// `requireSession` instead of the retired build-embedded `bearerMatches`; verification is local
// (jose vs cached JWKS), the token comes from the Authorization header or the same-origin cookie.
export { accessTokenFromCookieHeader, authCookieName, cookieTokenReader } from "./cookie.ts";
export {
  type RequireSessionConfig,
  requireOwner,
  requireSession,
  requireWrite,
  type SessionVars,
} from "./require-session.ts";
export {
  type KeyResolver,
  remoteJwks,
  type SessionClaims,
  type VerifyOptions,
  verifyAccessToken,
} from "./verify.ts";
