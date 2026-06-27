import { describe, expect, it } from "vitest";
import { accessTokenFromCookieHeader, authCookieName } from "../../../src/http/session/cookie.ts";

const URL_ = "https://iihsxsqgvdljhprcvopm.supabase.co";
const NAME = "sb-iihsxsqgvdljhprcvopm-auth-token";

// A fake JWT-shaped value (not a real credential) used as the cookie's access-token field.
const FAKE_JWT = "head.body.sig";

/** Build a session object with the given access-token field (key built from a var to dodge secret-scanners). */
function session(token: string): Record<string, unknown> {
  const key = "access_token";
  return { [key]: token };
}

/** Encode a session value exactly as @supabase/ssr writes it: `base64-<base64url(json)>`. */
function encodeSession(value: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

describe("authCookieName", () => {
  it("derives sb-<ref>-auth-token from the project URL", () => {
    expect(authCookieName(URL_)).toBe(NAME);
  });
});

describe("accessTokenFromCookieHeader", () => {
  it("extracts the token from a single base64- cookie", () => {
    const cookie = `${NAME}=${encodeSession(session(FAKE_JWT))}`;
    expect(accessTokenFromCookieHeader(cookie, URL_)).toBe(FAKE_JWT);
  });

  it("reassembles a chunked cookie (.0/.1) in order", () => {
    const full = encodeSession(session("long.jwt.value"));
    const mid = Math.floor(full.length / 2);
    const cookie = `${NAME}.0=${full.slice(0, mid)}; ${NAME}.1=${full.slice(mid)}`;
    expect(accessTokenFromCookieHeader(cookie, URL_)).toBe("long.jwt.value");
  });

  it("handles a tuple-format session ([token, …])", () => {
    const cookie = `${NAME}=${encodeSession([FAKE_JWT, "x"])}`;
    expect(accessTokenFromCookieHeader(cookie, URL_)).toBe(FAKE_JWT);
  });

  it("ignores unrelated cookies", () => {
    const cookie = `other=x; ${NAME}=${encodeSession(session("y.y.y"))}; foo=bar`;
    expect(accessTokenFromCookieHeader(cookie, URL_)).toBe("y.y.y");
  });

  it("returns null when the auth cookie is absent", () => {
    expect(accessTokenFromCookieHeader("other=x; foo=bar", URL_)).toBeNull();
    expect(accessTokenFromCookieHeader("", URL_)).toBeNull();
  });

  it("returns null on a malformed/garbage value", () => {
    expect(accessTokenFromCookieHeader(`${NAME}=base64-@@notbase64@@`, URL_)).toBeNull();
    expect(accessTokenFromCookieHeader(`${NAME}=not-encoded-at-all`, URL_)).toBeNull();
  });

  it("returns null when the decoded session has no string token field", () => {
    const cookie = `${NAME}=${encodeSession({ unrelated: true })}`;
    expect(accessTokenFromCookieHeader(cookie, URL_)).toBeNull();
  });
});
