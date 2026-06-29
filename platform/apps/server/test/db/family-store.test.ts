import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFamilyStore, type FamilySeed } from "../../src/db/family-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const seed: FamilySeed = {
  family: { familyId: FAMILY_ID, displayName: "Test Household" },
  members: [
    { userId: "placeholder:Arie", role: "owner", displayName: "אבא" },
    { userId: "placeholder:Partner", role: "member", displayName: "אמא" },
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
    const arie = members.find((m) => m.user_id === "placeholder:Arie");
    expect(arie?.role).toBe("owner");
    // #235: display_name seeded from the #14 config.members map (the real name the route serves, not the
    // placeholder user_id).
    expect(arie?.display_name).toBe("אבא");
    expect(members.find((m) => m.user_id === "placeholder:Partner")?.display_name).toBe("אמא");
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

  it("re-seeding FREEZES role (first-wins) but UPSERTS display_name (#235 — a config rename reflects)", () => {
    const path = tmpDbPath();
    createFamilyStore(path, seed); // first boot: Arie = owner, "אבא"
    // Second boot: same user_id, but a changed role AND a renamed display_name.
    const store = createFamilyStore(path, {
      ...seed,
      members: [{ userId: "placeholder:Arie", role: "member", displayName: "אבאל׳ה" }],
    });
    const arie = store.listMembers(FAMILY_ID).find((m) => m.user_id === "placeholder:Arie");
    expect(arie?.role).toBe("owner"); // frozen at first boot — NOT in the DO UPDATE set
    expect(arie?.display_name).toBe("אבאל׳ה"); // upserted — the rename took effect
  });

  it("backfills display_name on a PRE-EXISTING column-less family_members table (#235 migration)", () => {
    const path = tmpDbPath();
    // Simulate a DB seeded by #227 BEFORE the display_name column existed: the OLD table shape + a row.
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE family_members (
      family_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (family_id, user_id)
    );`);
    old
      .prepare("INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, ?);")
      .run(FAMILY_ID, "placeholder:Arie", "owner");
    old.close();

    // Boot the real store: PRAGMA detects the missing column → ALTER adds it → the seed upsert backfills.
    const store = createFamilyStore(path, seed);
    const arie = store.listMembers(FAMILY_ID).find((m) => m.user_id === "placeholder:Arie");
    expect(arie?.display_name).toBe("אבא"); // backfilled from the seed (was column-less before)
    expect(arie?.role).toBe("owner"); // role preserved (first-wins, untouched by the upsert)
  });

  it("#231 — listMembersWithVerification flags a member whose placeholder phone is bound; others false", () => {
    // Two members keyed by their (raw, un-normalized) phones; only the first phone is bound in family_phones.
    const withPhones: FamilySeed = {
      family: { familyId: FAMILY_ID, displayName: "Test Household" },
      members: [
        { userId: "placeholder:+972 50-123 4567", role: "owner", displayName: "אבא" },
        { userId: "placeholder:+972 54-999 8888", role: "member", displayName: "אמא" },
      ],
      // stored digit-normalized by the store → "972501234567" — matches אבא's number despite the formatting.
      phones: [{ fromPhone: "+972-50-123-4567", verifiedAt: "2026-06-26 09:00:00" }],
    };
    const store = createFamilyStore(":memory:", withPhones);
    const members = store.listMembersWithVerification(FAMILY_ID);
    const byName = (n: string) => members.find((m) => m.display_name === n);
    expect(byName("אבא")?.verified).toBe(true); // bound phone (normalized match across formats)
    expect(byName("אמא")?.verified).toBe(false); // no binding → unverified
  });

  it("#231 — every member is unverified when no phones are bound (the production default)", () => {
    const store = createFamilyStore(":memory:", seed); // seed has NO phones
    const members = store.listMembersWithVerification(FAMILY_ID);
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.verified === false)).toBe(true);
  });

  it("#231 — a non-placeholder user_id (a future real auth.uid) carries no phone → unverified", () => {
    const store = createFamilyStore(":memory:", {
      family: { familyId: FAMILY_ID, displayName: "Test Household" },
      members: [{ userId: "auth-uid-abc123", role: "owner", displayName: "אבא" }],
      phones: [{ fromPhone: "972501234567", verifiedAt: "2026-06-26 09:00:00" }],
    });
    expect(store.listMembersWithVerification(FAMILY_ID)[0]?.verified).toBe(false);
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
