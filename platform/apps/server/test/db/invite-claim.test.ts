import { describe, expect, it, vi } from "vitest";
import { createInviteClaim } from "../../src/db/invite-claim.ts";
import type { InviteRow } from "../../src/db/schema.ts";

function pendingInvite(over: Partial<InviteRow> = {}): InviteRow {
  return {
    invite_id: "inv-1",
    family_id: "fam-1",
    email: "spouse@example.com",
    role: "member",
    token: "tok-1",
    invited_by: "owner@example.com",
    status: "pending",
    expires_at: "2099-01-01 00:00:00",
    claimed_user_id: null,
    claimed_at: null,
    created_at: "2026-07-01 00:00:00",
    ...over,
  };
}

describe("createInviteClaim (#250 — claim-on-first-login orchestrator)", () => {
  it("provisions the member then marks the invite claimed, returning the invite's {familyId, role}", () => {
    const addMember = vi.fn();
    const claimInvite = vi.fn(() => true);
    const claim = createInviteClaim({
      inviteStore: { findPendingByEmail: () => pendingInvite({ role: "viewer" }), claimInvite },
      addMember,
    });

    const result = claim({ email: "spouse@example.com", userId: "auth-uid-99" });

    expect(result).toEqual({ familyId: "fam-1", role: "viewer" });
    // MEMBER-ROW-FIRST: addMember runs with the REAL auth.uid + the invite's role/family + the email.
    expect(addMember).toHaveBeenCalledWith({
      familyId: "fam-1",
      userId: "auth-uid-99",
      role: "viewer",
      email: "spouse@example.com",
    });
    expect(claimInvite).toHaveBeenCalledWith("inv-1", "auth-uid-99");
    // Ordering: the member row is written BEFORE the invite is marked claimed.
    expect(addMember.mock.invocationCallOrder[0]).toBeLessThan(
      claimInvite.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("returns null (no claim) when there is no pending invite for the email", () => {
    const addMember = vi.fn();
    const claim = createInviteClaim({
      inviteStore: { findPendingByEmail: () => null, claimInvite: vi.fn() },
      addMember,
    });
    expect(claim({ email: "stranger@example.com", userId: "auth-uid-1" })).toBeNull();
    expect(addMember).not.toHaveBeenCalled(); // no invite ⇒ no member write
  });

  it("FAIL-CLOSED: returns null and never marks claimed when the member write throws", () => {
    const claimInvite = vi.fn();
    const claim = createInviteClaim({
      inviteStore: { findPendingByEmail: () => pendingInvite(), claimInvite },
      addMember: () => {
        throw new Error("db write failed");
      },
    });
    expect(claim({ email: "spouse@example.com", userId: "auth-uid-1" })).toBeNull();
    expect(claimInvite).not.toHaveBeenCalled(); // never burn the invite if the row didn't persist
  });
});
