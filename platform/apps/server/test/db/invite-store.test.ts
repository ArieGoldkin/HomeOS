import { describe, expect, it } from "vitest";
import { createInviteStore } from "../../src/db/invite-store.ts";
import { FAMILY_ID } from "../../src/db/schema.ts";

describe("InviteStore — createInvite (#250)", () => {
  it("mints a pending invite with a normalized email, a default role, and an unguessable id+token", () => {
    const store = createInviteStore(":memory:");
    const inv = store.createInvite({ familyId: FAMILY_ID, email: "  Spouse@Gmail.com " });
    expect(inv.email).toBe("spouse@gmail.com"); // lower+trimmed on write (security item #2)
    expect(inv.role).toBe("member"); // default
    expect(inv.status).toBe("pending");
    expect(inv.family_id).toBe(FAMILY_ID);
    expect(inv.invite_id).toMatch(/^[0-9a-f-]{36}$/); // uuid PK
    expect(inv.token).toMatch(/^[0-9a-f-]{36}$/); // reserved option-B secret, distinct from the id
    expect(inv.token).not.toBe(inv.invite_id);
    expect(inv.claimed_user_id).toBeNull();
  });

  it("carries the requested role and invitedBy audit", () => {
    const store = createInviteStore(":memory:");
    const inv = store.createInvite({
      familyId: FAMILY_ID,
      email: "viewer@example.com",
      role: "viewer",
      invitedBy: "owner@example.com",
    });
    expect(inv.role).toBe("viewer");
    expect(inv.invited_by).toBe("owner@example.com");
  });

  it("re-inviting the same email supersedes the prior pending invite (no duplicate stacking)", () => {
    const store = createInviteStore(":memory:");
    const first = store.createInvite({
      familyId: FAMILY_ID,
      email: "dup@example.com",
      role: "member",
    });
    const second = store.createInvite({
      familyId: FAMILY_ID,
      email: "DUP@example.com",
      role: "viewer",
    });
    const pending = store.listPending(FAMILY_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.invite_id).toBe(second.invite_id);
    expect(pending[0]?.role).toBe("viewer"); // the refreshed role
    // The superseded invite is gone — its id no longer claims.
    expect(store.claimInvite(first.invite_id, "uid-x")).toBe(false);
  });
});

describe("InviteStore — findPendingByEmail (the gate lookup)", () => {
  it("matches case-insensitively + trims, returns the row", () => {
    const store = createInviteStore(":memory:");
    store.createInvite({ familyId: FAMILY_ID, email: "match@example.com", role: "member" });
    const found = store.findPendingByEmail("  MATCH@Example.com ");
    expect(found?.email).toBe("match@example.com");
    expect(found?.role).toBe("member");
  });

  it("returns null for an unknown email and for an empty email", () => {
    const store = createInviteStore(":memory:");
    store.createInvite({ familyId: FAMILY_ID, email: "known@example.com" });
    expect(store.findPendingByEmail("stranger@example.com")).toBeNull();
    expect(store.findPendingByEmail("   ")).toBeNull();
  });

  it("does not return an EXPIRED invite (read-time TTL, fake clock past 14d)", () => {
    let nowMs = Date.parse("2026-07-01T12:00:00Z");
    const store = createInviteStore(":memory:", () => new Date(nowMs));
    store.createInvite({ familyId: FAMILY_ID, email: "stale@example.com" });
    nowMs += 15 * 24 * 60 * 60 * 1000; // 15 days later — past the ~14d TTL
    expect(store.findPendingByEmail("stale@example.com")).toBeNull();
    expect(store.listPending(FAMILY_ID)).toEqual([]);
  });

  it("does not return a CLAIMED or REVOKED invite", () => {
    const store = createInviteStore(":memory:");
    const claimed = store.createInvite({ familyId: FAMILY_ID, email: "claimed@example.com" });
    store.claimInvite(claimed.invite_id, "uid-claimed");
    expect(store.findPendingByEmail("claimed@example.com")).toBeNull();

    const revoked = store.createInvite({ familyId: FAMILY_ID, email: "revoked@example.com" });
    store.revokeInvite(revoked.invite_id, FAMILY_ID);
    expect(store.findPendingByEmail("revoked@example.com")).toBeNull();
  });
});

describe("InviteStore — claimInvite (the auth-hot-path write)", () => {
  it("claims a pending invite once, recording the real uid; a replay is a no-op", () => {
    const store = createInviteStore(":memory:");
    const inv = store.createInvite({ familyId: FAMILY_ID, email: "claim@example.com" });
    expect(store.claimInvite(inv.invite_id, "auth-uid-1")).toBe(true);
    // Replay (retried first login) finds it already claimed → false, idempotent.
    expect(store.claimInvite(inv.invite_id, "auth-uid-1")).toBe(false);
  });

  it("returns false for an unknown invite id", () => {
    const store = createInviteStore(":memory:");
    expect(store.claimInvite("no-such-id", "auth-uid-1")).toBe(false);
  });
});

describe("InviteStore — revokeInvite (owner admin, family-scoped)", () => {
  it("revokes a pending invite scoped to the owner's family", () => {
    const store = createInviteStore(":memory:");
    const inv = store.createInvite({ familyId: FAMILY_ID, email: "revoke@example.com" });
    expect(store.revokeInvite(inv.invite_id, FAMILY_ID)).toBe(true);
    expect(store.listPending(FAMILY_ID)).toEqual([]);
  });

  it("cannot revoke an invite belonging to a DIFFERENT family (cross-family is a no-op)", () => {
    const store = createInviteStore(":memory:");
    const inv = store.createInvite({ familyId: FAMILY_ID, email: "scoped@example.com" });
    expect(store.revokeInvite(inv.invite_id, "fam-other")).toBe(false);
    expect(store.listPending(FAMILY_ID)).toHaveLength(1); // untouched
  });

  it("listPending is family-scoped + newest-first", () => {
    let nowMs = Date.parse("2026-07-01T12:00:00Z");
    const store = createInviteStore(":memory:", () => new Date(nowMs));
    store.createInvite({ familyId: FAMILY_ID, email: "first@example.com" });
    nowMs += 1000;
    store.createInvite({ familyId: FAMILY_ID, email: "second@example.com" });
    store.createInvite({ familyId: "fam-other", email: "other@example.com" });
    const pending = store.listPending(FAMILY_ID);
    expect(pending.map((i) => i.email)).toEqual(["second@example.com", "first@example.com"]);
  });
});
