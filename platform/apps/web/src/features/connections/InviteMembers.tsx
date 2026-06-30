import { useInvites, useRevokeInvite } from "@shared/hooks";
import { Button, Card, SectionLabel } from "@shared/ui";
import { useState } from "react";
import { InviteMemberDialog } from "./InviteMemberDialog";

/**
 * #250 (Slice 2b) — the owner's self-serve invite admin card on the Connections screen. OWNER-GATED by
 * capability: `useInvites` hits the owner-only `GET /invites`, which 403s a non-owner, so the query only
 * SUCCEEDS for an owner — we render the card iff `status === "success"` and otherwise render nothing (no
 * skeleton flash for the many non-owner / pre-resolution page loads). The web has no current-user role
 * otherwise, so this capability gate IS the gate. Security is server-side regardless (every /invites route
 * is owner-only); this only hides the affordance.
 *
 * Inviting is email-only (role implicitly `member`); the invitee just logs in with that Google account and
 * `requireSession` claims the invite — no code, no screen. Pending invites list with a revoke each; expiry is
 * the server's 14d TTL (re-invite to refresh). Mirrors the LinkedMembers card idiom (Card + SectionLabel).
 */
export function InviteMembers() {
  const { data: invites, status } = useInvites();
  const revoke = useRevokeInvite();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Owner gate (see above): render nothing unless the owner-only query succeeded.
  if (status !== "success") return null;

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="invite-members">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>הזמנת בני בית</SectionLabel>
        <Button
          variant="ink"
          className="min-h-9 px-3 text-[13px]"
          onClick={() => setDialogOpen(true)}
        >
          הזמינו
        </Button>
      </div>

      {invites.length === 0 ? (
        <p className="text-muted-foreground text-sm">אין הזמנות ממתינות.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((inv) => (
            <li
              key={inv.invite_id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--chip-border)] bg-[var(--chip-bg)] px-3.5 py-2.5"
            >
              <div className="flex min-w-0 flex-col">
                <span
                  dir="ltr"
                  className="truncate text-start font-semibold text-[13px] text-[color:var(--ink-2)]"
                >
                  {inv.email}
                </span>
                <span className="text-[12px] text-muted-foreground">ממתין/ה לכניסה ראשונה</span>
              </div>
              <Button
                variant="ghost"
                className="min-h-9 px-3 text-[13px]"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(inv.invite_id)}
              >
                ביטול
              </Button>
            </li>
          ))}
        </ul>
      )}

      <InviteMemberDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
