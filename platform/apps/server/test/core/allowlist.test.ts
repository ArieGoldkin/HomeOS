import { describe, expect, it } from "vitest";
import { isAllowed, normalizePhone } from "../../src/core/allowlist.ts";

describe("normalizePhone", () => {
  it("strips +, spaces, and dashes to digits only", () => {
    expect(normalizePhone("+972 50-123 4567")).toBe("972501234567");
  });
  it("returns empty string for non-numeric input", () => {
    expect(normalizePhone("abc")).toBe("");
  });
});

describe("isAllowed", () => {
  const allowlist = ["+972-50-123-4567", "972502222222"];

  it("allows a number matching an allowlist entry", () => {
    expect(isAllowed("972501234567", allowlist)).toBe(true);
  });
  it("ignores +/spacing differences between the two sides", () => {
    expect(isAllowed("+972 50 222 2222", allowlist)).toBe(true);
  });
  it("rejects a number not on the allowlist", () => {
    expect(isAllowed("972509999999", allowlist)).toBe(false);
  });
  it("rejects empty or garbage input", () => {
    expect(isAllowed("", allowlist)).toBe(false);
    expect(isAllowed("not-a-phone", allowlist)).toBe(false);
  });
});
