import { PersonAvatar } from "@shared/board";
import { useFamily } from "@shared/hooks";
import { Card, SectionLabel, Skeleton } from "@shared/ui";
import type { ReactNode } from "react";

const SKELETON_CHIPS = ["sk1", "sk2", "sk3"];

/**
 * "Linked members" (#182) — the household members whose forwarded messages the channel accepts. Reuses
 * PersonAvatar (the stable per-person color, never a token) as a wrapped row of member chips, matching the
 * Today household card idiom.
 *
 * #231 (Slice B) — the roster is the REAL verified members from `GET /family` (`m.verified` = their phone is
 * bound in family_phones), not the hardcoded LINKED_MEMBERS. Only verified members appear here (the channel
 * accepts forwards from bound numbers); the People board still lists everyone. Loading/empty/error are handled.
 */
export function LinkedMembers() {
  const { data, status } = useFamily();
  const verified = data?.members.filter((m) => m.verified) ?? [];

  let body: ReactNode;
  if (status === "pending") {
    body = (
      <div className="flex flex-wrap gap-2.5">
        {SKELETON_CHIPS.map((k) => (
          <Skeleton key={k} variant="line" className="h-9 w-24 rounded-full" />
        ))}
      </div>
    );
  } else if (status === "error") {
    body = <p className="text-muted-foreground text-sm">שגיאה בטעינת בני הבית — ננסה שוב בקרוב.</p>;
  } else if (verified.length === 0) {
    body = <p className="text-muted-foreground text-sm">אין בני בית מאומתים עדיין.</p>;
  } else {
    body = (
      <ul className="flex flex-wrap gap-2.5">
        {verified.map((m) => (
          <li
            key={m.name}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] py-1.5 pe-3.5 ps-1.5"
          >
            <PersonAvatar name={m.name} size={26} />
            <span className="font-semibold text-[13px] text-[color:var(--ink-2)]">{m.name}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="linked-members">
      <div className="flex items-center justify-between">
        <SectionLabel>בני בית מחוברים</SectionLabel>
        {status === "success" && (
          <span className="font-accent text-[13px] text-muted-foreground">
            {verified.length} מעבירים ללוח
          </span>
        )}
      </div>
      {body}
    </Card>
  );
}
