import { PersonAvatar } from "@shared/board";
import { Card } from "@shared/ui";

// The household whose forwards are allowlisted — a placeholder roster (mirrors FamilyView's KNOWN_ROSTER
// / TodayScreen's HOUSEHOLD) until a real identity/allowlist model is server-backed (deferred).
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
        <span className="font-semibold text-[14.5px] text-[color:var(--ink)]">בני בית מחוברים</span>
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
