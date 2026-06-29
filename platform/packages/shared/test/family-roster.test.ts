import { describe, expect, it } from "vitest";
import {
  channelResponseSchema,
  type FamilyMember,
  type FamilyRosterResponse,
  familyMemberSchema,
  familyRosterResponseSchema,
} from "../src/index.ts";

// Fixture mirrors the server's GET /family payload (#235, +#231 `verified`). The `: FamilyRosterResponse`
// annotation is the compile-time half — it fails typecheck if the schema/type drift from the served shape.
const roster: FamilyRosterResponse = {
  family: { display_name: "HomeOS Family" },
  members: [
    { name: "אבא", role: "owner", verified: true },
    { name: "אמא", role: "member", verified: false },
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
    const m: FamilyMember = { name: "נועה", role: "member", verified: true };
    expect(familyMemberSchema.parse(m)).toEqual(m);
  });

  it("#231 — defaults `verified` to false when omitted (additive: older payloads parse as unverified)", () => {
    const parsed = familyMemberSchema.parse({ name: "סבא", role: "member" });
    expect(parsed.verified).toBe(false);
    // a whole roster whose members omit `verified` still parses (the #235 inline fixtures rely on this).
    const legacy = familyRosterResponseSchema.parse({
      family: { display_name: "x" },
      members: [{ name: "אבא", role: "owner" }],
    });
    expect(legacy.members[0]?.verified).toBe(false);
  });

  it("#231 — rejects a non-boolean `verified` (shape-drift still fails loudly)", () => {
    expect(() =>
      familyMemberSchema.parse({ name: "אבא", role: "owner", verified: "yes" }),
    ).toThrow();
  });
});

describe("channelResponseSchema (the served GET /channel payload, #231)", () => {
  it("parses a configured bot number", () => {
    expect(channelResponseSchema.parse({ botPhone: "+972 50-123 4567" })).toEqual({
      botPhone: "+972 50-123 4567",
    });
  });

  it("parses a null bot number (BOT_PHONE_NUMBER unset on the server)", () => {
    expect(channelResponseSchema.parse({ botPhone: null }).botPhone).toBeNull();
  });

  it("rejects a missing botPhone (must be present, string|null)", () => {
    expect(() => channelResponseSchema.parse({})).toThrow();
  });
});
