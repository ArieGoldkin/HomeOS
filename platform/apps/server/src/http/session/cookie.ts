import type { Context } from "hono";

/** Derive the @supabase/ssr storage-key base from the project URL: `sb-<ref>-auth-token`. */
export function authCookieName(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

/** Minimal Cookie-header parser → name→value map (@supabase/ssr cookie values are URL-safe, no decode). */
function parseCookies(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * #225 — extract the Supabase access-token JWT from the request cookies with NO network call. @supabase/ssr
 * stores the session under `sb-<ref>-auth-token` (chunked into `.0`,`.1`,… when large); the value is
 * `base64-<base64url(JSON session)>`. We reassemble the chunks, base64url-decode, and pull `access_token`.
 * Verify-only by design: the SPA's own @supabase/ssr client refreshes the cookie, so the server never
 * refreshes (which would force a per-request round-trip + a Set-Cookie write-back). Returns null on
 * absence or ANY decode failure — the middleware then verifies it (and 401s on null).
 */
export function accessTokenFromCookieHeader(
  cookieHeader: string,
  supabaseUrl: string,
): string | null {
  const jar = parseCookies(cookieHeader);
  const base = authCookieName(supabaseUrl);
  let raw = jar.get(base);
  if (raw === undefined) {
    const chunks: string[] = [];
    for (let i = 0; ; i++) {
      const part = jar.get(`${base}.${i}`);
      if (part === undefined) break;
      chunks.push(part);
    }
    if (chunks.length === 0) return null;
    raw = chunks.join("");
  }
  let json = raw;
  if (json.startsWith("base64-")) {
    try {
      json = Buffer.from(json.slice("base64-".length), "base64url").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const at = (parsed as { access_token?: unknown }).access_token;
      return typeof at === "string" ? at : null;
    }
    // Older @supabase/ssr stored a tuple [access_token, refresh_token, …].
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
    return null;
  } catch {
    return null;
  }
}

/** Build the cookie token reader injected into {@link requireSession} in prod. */
export function cookieTokenReader(supabaseUrl: string): (c: Context) => string | null {
  return (c) => accessTokenFromCookieHeader(c.req.header("cookie") ?? "", supabaseUrl);
}
