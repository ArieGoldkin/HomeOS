// Imported via the @shared alias on purpose — this also asserts the alias resolves in Vitest.
import { cn } from "@shared/lib";
import { describe, expect, it } from "vitest";

describe("cn (and the @shared alias resolves)", () => {
  it("resolves conflicting Tailwind classes to the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values and joins the rest", () => {
    expect(cn("text-primary", false, undefined, "font-bold")).toBe("text-primary font-bold");
  });
});
