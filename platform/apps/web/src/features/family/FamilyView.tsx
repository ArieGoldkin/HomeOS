import { SectionHeader } from "@shared/board";
import { useEvents } from "@shared/hooks";
import { cn } from "@shared/lib";
import { Skeleton } from "@shared/ui";
import { FamilyGrid } from "./components/FamilyGrid";

/** The 4 known family persons (excluding "כולם" which is a group term, not a person). */
const KNOWN_ROSTER = ["אבא", "אמא", "יואב", "נועה"] as const;

const SKELETON_ROWS = ["sk1", "sk2", "sk3", "sk4"];

export interface FamilyViewProps {
  /** Called when the user activates the "הוספת בן משפחה" button. */
  onAddMember?: () => void;
  /** Grid columns — 1 (phone default) or 2 (the wider web surface). */
  columns?: 1 | 2;
  className?: string;
}

/**
 * Data-connected family roster screen. Derives the member list from the known roster UNION
 * any distinct non-null assignees from fetched events (excluding "כולם"). Presence is not yet
 * backed by a server — all members render as offline (online=false).
 */
export function FamilyView({ onAddMember, className, columns = 1 }: FamilyViewProps) {
  const { status, data: events } = useEvents();

  if (status === "pending") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <SectionHeader>המשפחה</SectionHeader>
        {SKELETON_ROWS.map((k) => (
          <Skeleton key={k} variant="line" className="w-full" />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={className}>
        <SectionHeader>המשפחה</SectionHeader>
        <p className="mt-3 text-sm text-muted-foreground">שגיאה בטעינת הרשימה — ננסה שוב בקרוב.</p>
      </div>
    );
  }

  // Build roster: start from known names, then union in any new assignees from events.
  const seen = new Set<string>(KNOWN_ROSTER);
  const extraNames: string[] = [];
  for (const event of events ?? []) {
    const a = event.assignee;
    if (a && a !== "כולם" && !seen.has(a)) {
      seen.add(a);
      extraNames.push(a);
    }
  }
  const members = [...KNOWN_ROSTER, ...extraNames].map((name) => ({ name }));

  return (
    <div className={className}>
      <SectionHeader className="mb-3">המשפחה</SectionHeader>
      <FamilyGrid members={members} columns={columns} onAddMember={onAddMember} />
    </div>
  );
}
