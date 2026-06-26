import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer check (avoids leaking the token via timing). Shared by the board/messages/write
 * routes (`server.ts`) AND the OAuth routes (`oauth-routes.ts`) — it lives in its own leaf module so
 * neither route file has to import the other, breaking the former `server.ts ↔ oauth-routes.ts` cycle
 * (see docs/refactor/server-decomposition-plan.md). The length-equality guard before `timingSafeEqual`
 * is load-bearing: the buffers must be equal length, and it rejects a missing / non-`Bearer ` header.
 */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
