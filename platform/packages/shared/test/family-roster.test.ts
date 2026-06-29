import { describe, expect, it } from "vitest";
import {
  type FamilyMember,
  type FamilyRosterResponse,
  familyMemberSchema,
  familyRosterResponseSchema,
} from "../src/index.ts";

// Fixture mirrors the server's GET /family payload (#235). The `: FamilyRosterResponse` annotation is the
// compile-time half — it fails typecheck if the schema/type drift from the served shape.
const roster: FamilyRosterResponse = {
  family: { display_name: "HomeOS Family" },
  members: [
    { name: "אבא", role: "owner" },
    { name: "אמא", role: "member" },
  ],
};

describe("familyRosterResponseSchema (the served GET /family payload)", () => {
  it("parses the roster envelope with family.display_name + members", () => {
    expect(familyRosterResponseSchema.parse(roster)).toEqual(roster);
  });

  it("parses an empty members list (a family with no seeded members yet)", () => {
    const empty: FamilyRosterResponse = { family: { display_name: "ריק" }, members: [] };
    expect(familyRosterResponseSchema.parse(empty).members).toEqual([]);
  });

  it("rejects a missing family or display_name (shape-drift fails loudly)", () => {
    expect(() => familyRosterResponseSchema.parse({ members: [] })).toThrow();
    expect(() => familyRosterResponseSchema.parse({ family: {}, members: [] })).toThrow();
  });

  it("rejects a member missing name or role", () => {
    expect(() =>
      familyRosterResponseSchema.parse({
        family: { display_name: "x" },
        members: [{ name: "אבא" }],
      }),
    ).toThrow();
    expect(() =>
      familyRosterResponseSchema.parse({
        family: { display_name: "x" },
        members: [{ role: "owner" }],
      }),
    ).toThrow();
  });

  it("exposes a usable FamilyMember type", () => {
    const m: FamilyMember = { name: "נועה", role: "member" };
    expect(familyMemberSchema.parse(m)).toEqual(m);
  });
});
