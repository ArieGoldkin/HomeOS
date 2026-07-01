import { describe, expect, it } from "vitest";
import {
  channelResponseSchema,
  type FamilyMember,
  type FamilyRosterResponse,
  familyMemberSchema,
  familyRosterResponseSchema,
} from "../src/index.ts";

// Fixture mirrors the server's GET /family payload (#235, +#266 family-level `whatsappConnected`). The
// `: FamilyRosterResponse` annotation is the compile-time half — it fails typecheck if the schema/type drift.
const roster: FamilyRosterResponse = {
  family: { display_name: "HomeOS Family", whatsappConnected: true },
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
    const empty: FamilyRosterResponse = {
      family: { display_name: "ריק", whatsappConnected: false },
      members: [],
    };
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

  it("exposes a usable FamilyMember type ({name, role} — #266 dropped per-member verified)", () => {
    const m: FamilyMember = { name: "נועה", role: "member" };
    expect(familyMemberSchema.parse(m)).toEqual(m);
  });

  it("#266 — strips a stale per-member `verified` (retired field is ignored, not an error)", () => {
    const parsed = familyMemberSchema.parse({ name: "סבא", role: "member", verified: true });
    expect(parsed).toEqual({ name: "סבא", role: "member" });
  });

  it("#266 — defaults family.whatsappConnected to false when omitted (additive: older payloads)", () => {
    const legacy = familyRosterResponseSchema.parse({
      family: { display_name: "x" },
      members: [{ name: "אבא", role: "owner" }],
    });
    expect(legacy.family.whatsappConnected).toBe(false);
  });

  it("#266 — rejects a non-boolean family.whatsappConnected (shape-drift fails loudly)", () => {
    expect(() =>
      familyRosterResponseSchema.parse({
        family: { display_name: "x", whatsappConnected: "yes" },
        members: [],
      }),
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
