import { describe, expect, it } from "vitest";
import { isProgrammingError, isTransient } from "../../src/core/errors.ts";

describe("isProgrammingError (OG10 / #57)", () => {
  it("classes built-in programming errors as TRUE (permanent → markFailed, never replay)", () => {
    expect(isProgrammingError(new TypeError("x is not a function"))).toBe(true);
    expect(isProgrammingError(new RangeError("out of range"))).toBe(true);
    expect(isProgrammingError(new ReferenceError("y is not defined"))).toBe(true);
    expect(isProgrammingError(new SyntaxError("bad json"))).toBe(true);
  });

  it("classes a statusless network error (ECONNRESET) as FALSE — that stays a transient retry", () => {
    const netErr = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(isProgrammingError(netErr)).toBe(false);
  });

  it("classes a permanent API error (4xx) as FALSE — handled by isTransient, not the guard", () => {
    expect(isProgrammingError(Object.assign(new Error("bad request"), { status: 400 }))).toBe(
      false,
    );
  });
});

describe("isTransient (unchanged by #57 — the guard is separate)", () => {
  it("treats a statusless network error (ECONNRESET) as transient (retryable) — NOT regressed", () => {
    const netErr = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(isTransient(netErr)).toBe(true);
  });

  it("treats a bare statusless error (incl. a programming bug) as transient — why the guard is needed", () => {
    // isTransient alone would replay a TypeError forever; isProgrammingError is the pre-check that
    // closes the boot-replay hole at the call site (parser.ts), without changing isTransient itself.
    expect(isTransient(new TypeError("x is not a function"))).toBe(true);
  });

  it("treats 429 and 5xx as transient, other 4xx as permanent", () => {
    expect(isTransient(Object.assign(new Error("rate limited"), { status: 429 }))).toBe(true);
    expect(isTransient(Object.assign(new Error("overloaded"), { status: 529 }))).toBe(true);
    expect(isTransient(Object.assign(new Error("server error"), { status: 500 }))).toBe(true);
    expect(isTransient(Object.assign(new Error("bad request"), { status: 400 }))).toBe(false);
    expect(isTransient(Object.assign(new Error("not found"), { status: 404 }))).toBe(false);
  });
});
