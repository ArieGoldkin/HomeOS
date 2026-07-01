import { usePhones, useUnbindPhone } from "@shared/hooks";
import { Button, Card, SectionLabel } from "@shared/ui";
import { useState } from "react";

/** Did the phones query fail with the owner-gate 403 (vs a transient error)? The api client throws
 *  `GET /phones failed (403)`, so the status is in the message. A 403 ⇒ NOT an owner ⇒ hide the card; any
 *  other error is a real owner's transient failure ⇒ show a notice, not a vanished affordance. */
function isForbidden(error: Error | null): boolean {
  return error?.message.includes("(403)") ?? false;
}

/**
 * #262 (Slice web) — the owner's WhatsApp-sender revocation card on the Connections screen. Since #259 made
 * `family_phones` the SOLE bot admission gate, this is the ONLY way to de-authorize a bound sender (dropping
 * a number from the ALLOWLIST env no longer revokes it). OWNER-GATED by capability, exactly like
 * {@link InviteMembers}: `usePhones` hits the owner-only `GET /phones`, which 403s a non-owner, so the query
 * only SUCCEEDS for an owner (security is server-side regardless — every /phones route is owner-only). The
 * gate is PRECISE: a 403 (or the pre-resolution pending state) renders nothing, while a NON-403 error (a real
 * owner's transient blip) shows a notice instead of silently hiding the card.
 *
 * Unbinding is a DESTROY action (the next forward from that number is refused), so it's confirm-before-destroy
 * (the product red line): the "ניתוק" button reveals an inline "אישור / ביטול" for that row only. This card is
 * read+revoke only — new bindings are earned through the wa.me/OTP ceremony (#228), never minted here.
 */
export function LinkedPhones() {
  const { data: phones, status, error } = usePhones();
  const unbind = useUnbindPhone();
  // The `from_phone` whose revoke is awaiting inline confirmation (at most one row at a time).
  const [confirming, setConfirming] = useState<string | null>(null);

  // Owner gate: a non-owner (403) and the pre-resolution pending state both render nothing.
  if (status === "pending" || (status === "error" && isForbidden(error))) return null;

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="linked-phones">
      <SectionLabel>מספרי וואטסאפ מורשים</SectionLabel>

      {status === "error" ? (
        <p role="alert" className="text-muted-foreground text-sm">
          שגיאה בטעינת המספרים — ננסה שוב בקרוב.
        </p>
      ) : phones.length === 0 ? (
        <p className="text-muted-foreground text-sm">אין מספרים מורשים.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {phones.map((p) => {
            const isConfirming = confirming === p.from_phone;
            const isPending = unbind.isPending && unbind.variables === p.from_phone;
            return (
              <li
                key={p.from_phone}
                className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--chip-border)] bg-[var(--chip-bg)] px-3.5 py-2.5"
              >
                <div className="flex min-w-0 flex-col">
                  <span
                    dir="ltr"
                    className="truncate text-start font-semibold text-[13px] text-[color:var(--ink-2)]"
                  >
                    {`+${p.from_phone}`}
                  </span>
                  <span className="text-[12px] text-muted-foreground">מספר מורשה לשליחה</span>
                </div>

                {isConfirming ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">לנתק?</span>
                    <Button
                      variant="ghost"
                      className="min-h-9 px-3 text-[13px] text-coral"
                      aria-label={`אישור ניתוק המספר ${p.from_phone}`}
                      disabled={isPending}
                      onClick={() =>
                        unbind.mutate(p.from_phone, { onSuccess: () => setConfirming(null) })
                      }
                    >
                      אישור
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-9 px-3 text-[13px]"
                      aria-label={`ביטול הניתוק של המספר ${p.from_phone}`}
                      disabled={isPending}
                      onClick={() => setConfirming(null)}
                    >
                      ביטול
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="min-h-9 px-3 text-[13px]"
                    aria-label={`ניתוק המספר ${p.from_phone}`}
                    onClick={() => setConfirming(p.from_phone)}
                  >
                    ניתוק
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {unbind.isError && (
        <p role="alert" className="text-[13px] text-coral">
          לא הצלחנו לנתק את המספר. נסו שוב.
        </p>
      )}
    </Card>
  );
}
