import { PersonAvatar } from "@shared/board";
import { Card, SectionLabel } from "@shared/ui";

// The household whose forwards are allowlisted — the LAST placeholder roster on the board (FamilyView +
// TodayScreen now read the real GET /family route, #235). Un-mocking this onto verified members
// (family_phones.verified_at) is owned by #231.
const LINKED_MEMBERS = ["אבא", "אמא", "יואב", "נועה"] as const;

/**
 * "Linked members" (#182) — the household members whose forwarded messages the channel accepts. Reuses
 * PersonAvatar (the stable per-person color, never a token) as a wrapped row of member chips, matching
 * the Today household card idiom.
 */
export function LinkedMembers() {
  return (
    <Card className="flex flex-col gap-3.5 p-[18px]" data-testid="linked-members">
      <div className="flex items-center justify-between">
        <SectionLabel>בני בית מחוברים</SectionLabel>
        <span className="font-accent text-[13px] text-muted-foreground">
          {LINKED_MEMBERS.length} מעבירים ללוח
        </span>
      </div>
      <ul className="flex flex-wrap gap-2.5">
        {LINKED_MEMBERS.map((name) => (
          <li
            key={name}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] py-1.5 pe-3.5 ps-1.5"
          >
            <PersonAvatar name={name} size={26} />
            <span className="font-semibold text-[13px] text-[color:var(--ink-2)]">{name}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
