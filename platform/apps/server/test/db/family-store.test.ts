import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFamilyStore, type FamilySeed } from "../../src/db/family-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

const seed: FamilySeed = {
  family: { familyId: FAMILY_ID, displayName: "Test Household" },
  members: [
    { userId: "placeholder:Arie", role: "owner" },
    { userId: "placeholder:Partner", role: "member" },
  ],
};

const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "homeos-family-"));
  tmpDirs.push(dir);
  return join(dir, "test.db");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("FamilyStore — seed + reads (#227)", () => {
  it("seeds exactly one family row + its members", () => {
    const store = createFamilyStore(":memory:", seed);
    const family = store.getFamily(FAMILY_ID);
    expect(family?.family_id).toBe(FAMILY_ID);
    expect(family?.display_name).toBe("Test Household");

    const members = store.listMembers(FAMILY_ID);
    expect(members.map((m) => m.user_id)).toEqual(["placeholder:Arie", "placeholder:Partner"]);
    expect(members.find((m) => m.user_id === "placeholder:Arie")?.role).toBe("owner");
  });

  it("getFamily returns null for an unknown family", () => {
    const store = createFamilyStore(":memory:", seed);
    expect(store.getFamily("nobody")).toBeNull();
  });

  it("listMembers returns [] for an unknown family", () => {
    const store = createFamilyStore(":memory:", seed);
    expect(store.listMembers("nobody")).toEqual([]);
  });

  it("seeds NO family_phones by default — bindings are earned via the ceremony, not hardcoded", () => {
    const store = createFamilyStore(":memory:", seed);
    expect(store.listPhones(FAMILY_ID)).toEqual([]);
  });

  it("works with no seed — tables exist, every read is empty/null", () => {
    const store = createFamilyStore(":memory:");
    expect(store.getFamily(FAMILY_ID)).toBeNull();
    expect(store.listMembers(FAMILY_ID)).toEqual([]);
    expect(store.listPhones(FAMILY_ID)).toEqual([]);
  });

  it("is idempotent across boots — re-seeding never duplicates rows or overwrites the family", () => {
    const path = tmpDbPath();
    createFamilyStore(path, seed); // first boot writes the seed
    // Second boot with a DIFFERENT display name: INSERT OR IGNORE keeps the original (first wins).
    const store = createFamilyStore(path, {
      ...seed,
      family: { familyId: FAMILY_ID, displayName: "Renamed" },
    });
    expect(store.getFamily(FAMILY_ID)?.display_name).toBe("Test Household");
    expect(store.listMembers(FAMILY_ID)).toHaveLength(2);
  });

  it("optionally seeds a bootstrap phone digit-normalized, de-duplicated on the PK", () => {
    const path = tmpDbPath();
    const withPhone: FamilySeed = {
      ...seed,
      phones: [{ fromPhone: "+972 50-123 4567", verifiedAt: "2026-06-26 09:00:00" }],
    };
    createFamilyStore(path, withPhone); // first boot
    const store = createFamilyStore(path, withPhone); // re-boot — must not duplicate the binding
    const phones = store.listPhones(FAMILY_ID);
    expect(phones).toHaveLength(1);
    expect(phones[0]?.from_phone).toBe("972501234567"); // stored normalized, as the resolver compares
    expect(phones[0]?.verified_at).toBe("2026-06-26 09:00:00");
  });
});
