import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFamilyResolver } from "../../src/db/family-resolver.ts";
import { createFamilyStore, type FamilySeed } from "../../src/db/family-store.ts";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

// The resolver + the seed store are two SEPARATE node:sqlite connections, so a shared FILE (not :memory:,
// which is per-connection) is required for one to read what the other wrote — and that round-trip through
// the REAL sibling writer is exactly what proves normalization parity with the production path.
const tmpDirs: string[] = [];
function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "homeos-resolver-"));
  tmpDirs.push(dir);
  return join(dir, "test.db");
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Seed one family (+ optional phone, written through the real FamilyStore so it normalizes as in prod). */
function seedFamily(
  path: string,
  familyId: string,
  opts: {
    phone?: string;
    members?: Array<{ userId: string; role: string; displayName: string; email?: string }>;
  } = {},
): void {
  const seed: FamilySeed = {
    family: { familyId, displayName: `Family ${familyId}` },
    members: opts.members ?? [
      { userId: `placeholder:${familyId}`, role: "owner", displayName: "Owner" },
    ],
    ...(opts.phone
      ? { phones: [{ fromPhone: opts.phone, verifiedAt: "2026-06-26 09:00:00" }] }
      : {}),
  };
  createFamilyStore(path, seed);
}

describe("FamilyResolver — the phone→family security chokepoint (#229)", () => {
  it("resolves a bound phone to its family_id", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", { phone: "972501234567" });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveFamilyByPhone("972501234567")).toBe("default");
  });

  it("returns null for an unbound phone (no fall-through to a default family)", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", { phone: "972501234567" });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveFamilyByPhone("972509999999")).toBeNull();
  });

  it("unbinding a phone makes resolution fail (delete the row → null)", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", { phone: "972501234567" });
    // Remove the binding directly (the unbind/ceremony-revoke effect), then re-open a fresh resolver.
    const db = new DatabaseSync(path);
    db.prepare("DELETE FROM family_phones WHERE from_phone = ?;").run("972501234567");
    db.close();
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveFamilyByPhone("972501234567")).toBeNull();
  });

  it("normalizes the phone round-trip: a number bound in one format resolves when sent in another", () => {
    const path = tmpDbPath();
    // Bound with punctuation/spaces; FamilyStore stores it digit-normalized (972501234567).
    seedFamily(path, "default", { phone: "+972 50-123 4567" });
    const resolver = createFamilyResolver(path);
    // Equivalent forms all resolve...
    expect(resolver.resolveFamilyByPhone("972501234567")).toBe("default");
    expect(resolver.resolveFamilyByPhone("+972-50-123-4567")).toBe("default");
    expect(resolver.resolveFamilyByPhone("972 50 123 4567")).toBe("default");
    // ...but a non-equivalent number (different digits) does NOT.
    expect(resolver.resolveFamilyByPhone("972501234568")).toBeNull();
  });

  it("isolates two phones bound to two families — each resolves to its own, never the other's (N=1 cross-family)", () => {
    const path = tmpDbPath();
    seedFamily(path, "family-a", { phone: "972500000001" });
    seedFamily(path, "family-b", { phone: "972500000002" });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveFamilyByPhone("972500000001")).toBe("family-a");
    expect(resolver.resolveFamilyByPhone("972500000002")).toBe("family-b");
    // Explicit cross-check: neither phone ever leaks the other family's id.
    expect(resolver.resolveFamilyByPhone("972500000001")).not.toBe("family-b");
    expect(resolver.resolveFamilyByPhone("972500000002")).not.toBe("family-a");
  });

  it("is DETERMINISTIC if the one-phone-one-family invariant is broken — ORDER BY, never an arbitrary flap", () => {
    const path = tmpDbPath();
    seedFamily(path, "family-a"); // create both families (members) first
    seedFamily(path, "family-b");
    // Force the invariant-broken state the resolver must survive: the SAME phone under TWO families.
    const db = new DatabaseSync(path);
    const ins = db.prepare(
      "INSERT INTO family_phones (family_id, from_phone, verified_at) VALUES (?, ?, ?);",
    );
    ins.run("family-b", "972500000009", "2026-06-26 09:00:00");
    ins.run("family-a", "972500000009", "2026-06-26 09:00:00");
    db.close();
    const resolver = createFamilyResolver(path);
    // ORDER BY family_id → the lexicographically-first family, every call (no nondeterministic LIMIT 1).
    expect(resolver.resolveFamilyByPhone("972500000009")).toBe("family-a");
    expect(resolver.resolveFamilyByPhone("972500000009")).toBe("family-a");
  });

  it("resolveFamilyByUser returns the member's family and null for a non-member", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", {
      members: [
        { userId: "auth-uid-arie", role: "owner", displayName: "Arie" },
        { userId: "auth-uid-partner", role: "member", displayName: "Partner" },
      ],
    });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveFamilyByUser("auth-uid-arie")).toBe("default");
    expect(resolver.resolveFamilyByUser("auth-uid-partner")).toBe("default");
    expect(resolver.resolveFamilyByUser("stranger")).toBeNull();
  });

  it("resolveMembership returns the member's {familyId, role} and null for a non-member (#226)", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", {
      members: [
        { userId: "auth-uid-arie", role: "owner", displayName: "Arie" },
        { userId: "auth-uid-partner", role: "member", displayName: "Partner" },
      ],
    });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveMembership("auth-uid-arie")).toEqual({
      familyId: "default",
      role: "owner",
    });
    expect(resolver.resolveMembership("auth-uid-partner")).toEqual({
      familyId: "default",
      role: "member",
    });
    expect(resolver.resolveMembership("stranger")).toBeNull();
  });

  it("resolveMembershipByEmail returns {familyId, role} for a seeded member email (uid↔member binding)", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", {
      members: [
        { userId: "placeholder:1", role: "owner", displayName: "אבא", email: "Arie@Gmail.com" },
        { userId: "placeholder:2", role: "member", displayName: "אמא", email: "partner@gmail.com" },
      ],
    });
    const resolver = createFamilyResolver(path);
    // case-insensitive: a config "Arie@Gmail.com" resolves the JWT's lower-cased "arie@gmail.com"
    expect(resolver.resolveMembershipByEmail("arie@gmail.com")).toEqual({
      familyId: "default",
      role: "owner",
    });
    // and tolerant of surrounding whitespace + mixed case on the input
    expect(resolver.resolveMembershipByEmail("  PARTNER@gmail.com  ")).toEqual({
      familyId: "default",
      role: "member",
    });
  });

  it("resolveMembershipByEmail returns null for an unknown email, an un-emailed member, and an empty input", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", {
      members: [
        { userId: "placeholder:1", role: "owner", displayName: "אבא", email: "arie@gmail.com" },
        { userId: "placeholder:2", role: "member", displayName: "אמא" }, // NO email → not bindable
      ],
    });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveMembershipByEmail("stranger@example.com")).toBeNull(); // unknown
    expect(resolver.resolveMembershipByEmail("")).toBeNull(); // empty never resolves
    // a member seeded without an email must NOT match a NULL/empty lookup
    expect(resolver.resolveMembershipByEmail("  ")).toBeNull();
  });

  it("is injection-safe — metacharacter-laden input resolves to null and never executes SQL", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", { phone: "972501234567" });
    const resolver = createFamilyResolver(path);
    // Phone path: normalizePhone strips to "" → guarded null; the table is untouched.
    expect(resolver.resolveFamilyByPhone("'; DROP TABLE family_phones; --")).toBeNull();
    // User path (no normalization): a parameterized statement treats it as a literal → null, no injection.
    expect(resolver.resolveFamilyByUser("' OR '1'='1")).toBeNull();
    // Prove the table survived (DROP did not run): the legit binding still resolves.
    expect(resolver.resolveFamilyByPhone("972501234567")).toBe("default");
  });

  it("empty / no-resolver edge: an empty phone resolves to null", () => {
    const path = tmpDbPath();
    seedFamily(path, "default", { phone: "972501234567" });
    const resolver = createFamilyResolver(path);
    expect(resolver.resolveFamilyByPhone("")).toBeNull();
    expect(resolver.resolveFamilyByPhone("   ")).toBeNull();
  });
});
