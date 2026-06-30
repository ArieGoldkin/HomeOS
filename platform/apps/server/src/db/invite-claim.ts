import type { FamilyStore } from "./family-store.ts";
import type { InviteStore } from "./invite-store.ts";

/**
 * The claim-on-first-login orchestrator (#250, mechanism A). Given a verified session that is NOVEL —
 * neither a returning member nor on the static break-glass floor — it provisions membership from a pending
 * email-scoped invite. Returns the new `{familyId, role}` on a successful claim, or null when there is no
 * pending invite OR the member write fails. It is the single seam `requireSession` calls in its claim
 * branch, so the cross-connection dance (the member write lives on the FamilyStore connection, the invite
 * mark on the InviteStore connection — no single transaction until the RLS migration) lives in ONE
 * unit-testable place rather than inside the HTTP middleware.
 */
export type ClaimPendingInvite = (params: {
  email: string;
  userId: string;
}) => { familyId: string; role: string } | null;

export function createInviteClaim(deps: {
  inviteStore: Pick<InviteStore, "findPendingByEmail" | "claimInvite">;
  addMember: FamilyStore["addMember"];
}): ClaimPendingInvite {
  return ({ email, userId }) => {
    const invite = deps.inviteStore.findPendingByEmail(email);
    if (invite === null) return null;
    try {
      // MEMBER-ROW-FIRST, then mark-claimed: if the process dies between the two writes, only a benign stale
      // pending invite remains (TTL-swept), and the membership!=null guard makes the retried login the
      // idempotent fast path. addMember writes the REAL auth.uid (no placeholder) on the FamilyStore
      // connection — the one that ran the email ALTER, so resolveMembershipByEmail resolves it next request.
      deps.addMember({ familyId: invite.family_id, userId, role: invite.role, email });
      deps.inviteStore.claimInvite(invite.invite_id, userId);
    } catch {
      return null; // FAIL-CLOSED: a failed member write must never admit a session without a persisted row.
    }
    return { familyId: invite.family_id, role: invite.role };
  };
}
