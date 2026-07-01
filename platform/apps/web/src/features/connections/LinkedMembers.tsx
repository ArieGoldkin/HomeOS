import { useFamily } from "@shared/hooks";
import { Card, SectionLabel, Skeleton } from "@shared/ui";
import type { ReactNode } from "react";

/**
 * WhatsApp connection status for the home (#182, reworked in #266).
 *
 * #266 — the per-member "verified" roster was RETIRED: `family_phones` is FAMILY-scoped (a bound number
 * belongs to the home, not a specific person), so a per-person checkmark was unanswerable once members carry
 * real `auth.uid()`s. `GET /family` now exposes a single family-level `family.whatsappConnected` (true iff the
 * home has ≥1 bound number); this card reflects it. The People board (`FamilyView`) lists the members; the
 * channel hero (`WhatsAppChannelCard`) shows the bot number to forward TO. A genuine per-member binding signal
 * needs a real uid↔phone table (deferred to N>1). Loading/empty/error are handled.
 */
export function LinkedMembers() {
  const { data, status } = useFamily();
  const connected = data?.family.whatsappConnected ?? false;

  let body: ReactNode;
  if (status === "pending") {
    body = <Skeleton variant="line" className="h-9 w-48 rounded-full" />;
  } else if (status === "error") {
    body = (
      <p className="text-muted-foreground text-sm">שגיאה בטעינת מצב החיבור — ננסה שוב בקרוב.</p>
    );
  } else if (connected) {
    body = (
      <p className="text-[color:var(--ink-2)] text-sm">
        WhatsApp מחובר — ההעברות ממספרי הבית המאומתים נקלטות בלוח.
      </p>
    );
  } else {
    body = <p className="text-muted-foreground text-sm">אין עדיין מספר WhatsApp מחובר לבית.</p>;
  }

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="linked-members">
      <SectionLabel>חיבור WhatsApp</SectionLabel>
      {body}
    </Card>
  );
}
