import { useInvites, useRevokeInvite } from "@shared/hooks";
import { Button, Card, SectionLabel } from "@shared/ui";
import { useState } from "react";
import { InviteMemberDialog } from "./InviteMemberDialog";

/** Did the invites query fail with the owner-gate 403 (vs a transient error)? The api client throws
 *  `GET /invites failed (403)`, so the status is in the message. A 403 ⇒ NOT an owner ⇒ hide the card; any
 *  other error is a real owner's transient failure ⇒ show a notice, not a vanished affordance. */
function isForbidden(error: Error | null): boolean {
  return error?.message.includes("(403)") ?? false;
}

/**
 * #250 (Slice 2b) — the owner's self-serve invite admin card on the Connections screen. OWNER-GATED by
 * capability: `useInvites` hits the owner-only `GET /invites`, which 403s a non-owner, so the query only
 * SUCCEEDS for an owner. The web has no current-user role otherwise, so this capability gate IS the gate;
 * security is server-side regardless (every /invites route is owner-only). The gate is PRECISE: a 403 (or
 * the pre-resolution pending state) renders nothing — no affordance, no skeleton flash for the many
 * non-owner page loads — while a NON-403 error (a real owner's transient 500/network blip) shows a notice
 * instead of silently hiding the card (it refetches on mount/refocus).
 *
 * Inviting is email-only (role implicitly `member`); the invitee just logs in with that Google account and
 * `requireSession` claims the invite — no code, no screen. Pending invites list with a revoke each; expiry is
 * the server's 14d TTL (re-invite to refresh). Mirrors the LinkedMembers card idiom (Card + SectionLabel).
 */
export function InviteMembers() {
  const { data: invites, status, error } = useInvites();
  const revoke = useRevokeInvite();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Owner gate: a non-owner (403) and the pre-resolution pending state both render nothing.
  if (status === "pending" || (status === "error" && isForbidden(error))) return null;

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

      {status === "error" ? (
        <p role="alert" className="text-muted-foreground text-sm">
          שגיאה בטעינת ההזמנות — ננסה שוב בקרוב.
        </p>
      ) : invites.length === 0 ? (
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
                aria-label={`ביטול הזמנה ל-${inv.email}`}
                // Disable ONLY the in-flight row (revoke.variables is the id passed to mutate), not every row.
                disabled={revoke.isPending && revoke.variables === inv.invite_id}
                onClick={() => revoke.mutate(inv.invite_id)}
              >
                ביטול
              </Button>
            </li>
          ))}
        </ul>
      )}

      {revoke.isError && (
        <p role="alert" className="text-[13px] text-coral">
          לא הצלחנו לבטל את ההזמנה. נסו שוב.
        </p>
      )}

      <InviteMemberDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </Card>
  );
}
