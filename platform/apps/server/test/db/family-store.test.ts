import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFamilyStore,
  type FamilySeed,
  PLACEHOLDER_USER_ID_PREFIX,
} from "../../src/db/family-store.ts";
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

  it("uid↔member binding — seeds the member's email and UPSERTS it on re-boot (role stays first-wins)", () => {
    const path = tmpDbPath();
    createFamilyStore(path, {
      ...seed,
      members: [
        { userId: "placeholder:Arie", role: "owner", displayName: "אבא", email: "arie@gmail.com" },
      ],
    });
    // re-boot with a changed email — upserted like display_name; role frozen at the first boot.
    const store = createFamilyStore(path, {
      ...seed,
      members: [
        {
          userId: "placeholder:Arie",
          role: "member",
          displayName: "אבא",
          email: "arie2@gmail.com",
        },
      ],
    });
    const arie = store.listMembers(FAMILY_ID).find((m) => m.user_id === "placeholder:Arie");
    expect(arie?.email).toBe("arie2@gmail.com"); // upserted (a config change reflects)
    expect(arie?.role).toBe("owner"); // frozen (first-wins)
  });

  it("uid↔member binding — a member seeded WITHOUT an email has email null (not bindable yet)", () => {
    const store = createFamilyStore(":memory:", seed); // the default seed's members carry no email
    expect(store.listMembers(FAMILY_ID).every((m) => m.email === null)).toBe(true);
  });

  it("uid↔member binding — backfills the email column on a PRE-EXISTING column-less table", () => {
    const path = tmpDbPath();
    // A #235-era table: it has display_name but NOT the new email column.
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE family_members (
      family_id    TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      role         TEXT NOT NULL,
      display_name TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (family_id, user_id)
    );`);
    old
      .prepare("INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, ?);")
      .run(FAMILY_ID, "placeholder:Arie", "owner");
    old.close();

    // Boot the real store: PRAGMA detects the missing email column → ALTER adds it → the seed upsert backfills.
    const store = createFamilyStore(path, {
      ...seed,
      members: [
        { userId: "placeholder:Arie", role: "owner", displayName: "אבא", email: "arie@gmail.com" },
      ],
    });
    const arie = store.listMembers(FAMILY_ID).find((m) => m.user_id === "placeholder:Arie");
    expect(arie?.email).toBe("arie@gmail.com"); // column added + backfilled on the same boot
    expect(arie?.display_name).toBe("אבא"); // the pre-existing display_name path still works
  });

  it("#266 — reconcileMemberUid upgrades the email-genesis placeholder owner to the real auth.uid in place", () => {
    const store = createFamilyStore(":memory:", {
      family: { familyId: FAMILY_ID, displayName: "Test Household" },
      members: [
        {
          userId: "placeholder:email:arie@gmail.com",
          role: "owner",
          displayName: "arie",
          email: "arie@gmail.com",
        },
      ],
    });
    // Matched case-insensitively by email; the verified JWT email may differ in case.
    expect(
      store.reconcileMemberUid({
        familyId: FAMILY_ID,
        email: "Arie@Gmail.com",
        userId: "auth-uid-real",
      }),
    ).toBe(true);
    const owner = store.listMembers(FAMILY_ID)[0];
    expect(owner?.user_id).toBe("auth-uid-real");
    expect(owner?.role).toBe("owner"); // role untouched
    expect(owner?.email).toBe("arie@gmail.com");
  });

  it("#266 — reconcileMemberUid also upgrades a LEGACY placeholder:<phone> owner (prod migration, for free)", () => {
    const path = tmpDbPath();
    // Simulate the live prod row: phone-keyed placeholder + the owner's email already on it.
    const store = createFamilyStore(path, {
      family: { familyId: FAMILY_ID, displayName: "Test Household" },
      members: [
        {
          userId: "placeholder:972547039199",
          role: "owner",
          displayName: "אבא",
          email: "arie@gmail.com",
        },
      ],
    });
    expect(
      store.reconcileMemberUid({
        familyId: FAMILY_ID,
        email: "arie@gmail.com",
        userId: "auth-uid-real",
      }),
    ).toBe(true);
    expect(store.listMembers(FAMILY_ID)[0]?.user_id).toBe("auth-uid-real");
  });

  it("#266 — reconcileMemberUid is idempotent: a second/concurrent call (uid already real) is a no-op", () => {
    const store = createFamilyStore(":memory:", {
      family: { familyId: FAMILY_ID, displayName: "Test Household" },
      members: [
        {
          userId: "placeholder:email:arie@gmail.com",
          role: "owner",
          displayName: "arie",
          email: "arie@gmail.com",
        },
      ],
    });
    expect(
      store.reconcileMemberUid({
        familyId: FAMILY_ID,
        email: "arie@gmail.com",
        userId: "auth-uid-real",
      }),
    ).toBe(true);
    // The row no longer matches LIKE 'placeholder:%' → false, and never flips to a different uid.
    expect(
      store.reconcileMemberUid({
        familyId: FAMILY_ID,
        email: "arie@gmail.com",
        userId: "auth-uid-OTHER",
      }),
    ).toBe(false);
    expect(store.listMembers(FAMILY_ID)[0]?.user_id).toBe("auth-uid-real");
  });

  it("#266 — reconcileMemberUid returns false for an unknown email (no row upgraded)", () => {
    const store = createFamilyStore(":memory:", seed);
    expect(
      store.reconcileMemberUid({ familyId: FAMILY_ID, email: "stranger@example.com", userId: "x" }),
    ).toBe(false);
  });

  // The exact has-owner-guarded email-genesis the composition root (index.ts) runs — verified against the
  // real store + the resolver the gate reads, so the owner is admitted as `owner` by a pure read.
  function genesisSeed(store: ReturnType<typeof createFamilyStore>, ownerEmail: string) {
    const hasOwner = store.listMembers(FAMILY_ID).some((m) => m.role === "owner");
    if (!hasOwner) {
      store.addMember({
        familyId: FAMILY_ID,
        userId: `${PLACEHOLDER_USER_ID_PREFIX}email:${ownerEmail.toLowerCase()}`,
        role: "owner",
        displayName: ownerEmail.split("@")[0],
        email: ownerEmail,
      });
    }
  }

  it("#266 — email genesis: a fresh DB seeds the owner from [0]; the resolver resolves it as owner (admit-by-read)", async () => {
    const path = tmpDbPath();
    const store = createFamilyStore(path, {
      family: { familyId: FAMILY_ID, displayName: "HomeOS Family" },
    });
    genesisSeed(store, "arie@gmail.com");
    const { createFamilyResolver } = await import("../../src/db/family-resolver.ts");
    expect(createFamilyResolver(path).resolveMembershipByEmail("arie@gmail.com")).toEqual({
      familyId: FAMILY_ID,
      role: "owner",
    });
  });

  it("#266 — email genesis is idempotent: re-running on a DB that already has an owner adds no second owner", () => {
    const path = tmpDbPath();
    const store = createFamilyStore(path, {
      family: { familyId: FAMILY_ID, displayName: "HomeOS Family" },
    });
    genesisSeed(store, "arie@gmail.com");
    genesisSeed(createFamilyStore(path), "someone-else@gmail.com"); // second boot, different [0]
    const owners = createFamilyStore(path)
      .listMembers(FAMILY_ID)
      .filter((m) => m.role === "owner");
    expect(owners).toHaveLength(1);
    expect(owners[0]?.email).toBe("arie@gmail.com"); // first-wins; the genesis never moves ownership
  });

  it("#250 — addMember inserts a member with the real auth.uid and a normalized email (the claim path)", () => {
    const store = createFamilyStore(":memory:", seed);
    store.addMember({
      familyId: FAMILY_ID,
      userId: "auth-uid-real-123",
      role: "member",
      email: "  NewSpouse@Gmail.com ", // surrounding whitespace + mixed case
    });
    const added = store.listMembers(FAMILY_ID).find((m) => m.user_id === "auth-uid-real-123");
    expect(added?.role).toBe("member");
    expect(added?.email).toBe("newspouse@gmail.com"); // trim + lower on write (security item #2)
    expect(added?.display_name).toBeNull(); // claim carries no display name (the user edits it later)
  });

  it("#250 — addMember's email survives the resolver's LOWER(email) match (write↔read coherence)", async () => {
    const path = tmpDbPath();
    const store = createFamilyStore(path, seed);
    store.addMember({
      familyId: FAMILY_ID,
      userId: "auth-uid-resolve",
      role: "member",
      email: " Coherence@Example.com ",
    });
    // Read back through the resolver's own connection (the membership-by-email gate the claim unblocks).
    const { createFamilyResolver } = await import("../../src/db/family-resolver.ts");
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveMembershipByEmail("coherence@example.com")).toEqual({
      familyId: FAMILY_ID,
      role: "member",
    });
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
