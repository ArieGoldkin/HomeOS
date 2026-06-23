import { describe, expect, it } from "vitest";
import { assigneeColor } from "./assignee-color";

describe("assigneeColor", () => {
  it("is deterministic for the same input", () => {
    expect(assigneeColor("דנה")).toEqual(assigneeColor("דנה"));
  });

  it("maps a seeded name to its fixed pair", () => {
    expect(assigneeColor("אבא").light).toBe("#1E9E6F"); // green
    expect(assigneeColor("אמא").light).toBe("#3686D8"); // blue
  });

  it("returns light, night, and precomputed wash fallbacks", () => {
    const c = assigneeColor("מישהו אקראי");
    expect(c.light).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(c.night).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(c.lightWash).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(c.nightWash).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("handles null/empty assignee with a stable neutral default", () => {
    expect(assigneeColor(null)).toEqual(assigneeColor(undefined));
    expect(assigneeColor("  ")).toEqual(assigneeColor(null));
  });
});
