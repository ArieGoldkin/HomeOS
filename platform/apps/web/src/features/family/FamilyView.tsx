import type { SavedEvent } from "@homeos/shared";
import { PersonAvatar } from "@shared/board";
import { useEvents } from "@shared/hooks";
import { cn } from "@shared/lib";
import { Button, Card, Skeleton, StatusPill } from "@shared/ui";

/** The 4 known family persons (excluding "כולם" which is a group term, not a person). */
const KNOWN_ROSTER = ["אבא", "אמא", "יואב", "נועה"] as const;

const SKELETON_ROWS = ["sk1", "sk2", "sk3", "sk4"];

export interface FamilyViewProps {
  /** Called when the user activates the invite button. */
  onAddMember?: () => void;
  className?: string;
}

/** Static role label (no server-backed roles yet) — parents vs household member. */
function roleOf(name: string): string {
  return name === "אבא" || name === "אמא" ? "הורה" : "בן בית";
}

function rosterFrom(events: SavedEvent[] | undefined): string[] {
  const seen = new Set<string>(KNOWN_ROSTER);
  const extra: string[] = [];
  for (const event of events ?? []) {
    const a = event.assignee;
    if (a && a !== "כולם" && !seen.has(a)) {
      seen.add(a);
      extra.push(a);
    }
  }
  return [...KNOWN_ROSTER, ...extra];
}

/**
 * The People screen (#181) — the Modern "household" layout: kicker + heading + invite, a stat chip, and
 * a data table (avatar+name · status · role) per design-system §08. The roster derives from the known
 * names UNION any distinct event assignees. Status is a static placeholder ("פעיל") — real presence is
 * deferred (not server-backed); roles are a simple parent/member mapping.
 */
export function FamilyView({ onAddMember, className }: FamilyViewProps) {
  const { status, data: events } = useEvents();

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          מי בבית
        </div>
        <h1 className="mt-2 font-display font-extrabold text-[34px] text-[color:var(--ink)] leading-[1.05] tracking-tight">
          בני <span className="font-accent font-medium text-primary">הבית</span>
        </h1>
      </div>
      <Button
        variant="ink"
        className="min-h-0 rounded-[var(--radius-sm)] px-4 py-2 text-[13px]"
        onClick={onAddMember}
      >
        + הזמנת בן בית
      </Button>
    </div>
  );

  if (status === "pending") {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        {header}
        <Card className="flex flex-col gap-3 p-[18px]">
          {SKELETON_ROWS.map((k) => (
            <Skeleton key={k} variant="line" className="w-full" />
          ))}
        </Card>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={cn("flex flex-col gap-6", className)}>
        {header}
        <p className="text-muted-foreground text-sm">שגיאה בטעינת הרשימה — ננסה שוב בקרוב.</p>
      </div>
    );
  }

  const members = rosterFrom(events);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {header}

      <div className="flex flex-wrap gap-2.5">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-border)] bg-[var(--chip-bg)] px-4 py-2 font-semibold text-[12.5px] text-[color:var(--ink-2)]">
          <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
          {members.length} בני בית
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1.7fr_1fr_1fr] border-[var(--line)] border-b px-5 py-3 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
          <span>שם</span>
          <span>סטטוס</span>
          <span>תפקיד</span>
        </div>
        {members.map((name, i) => (
          <div
            key={name}
            className={cn(
              "grid grid-cols-[1.7fr_1fr_1fr] items-center px-5 py-3",
              i < members.length - 1 && "border-[var(--line)] border-b",
            )}
          >
            <span className="flex items-center gap-3">
              <PersonAvatar name={name} size={30} />
              <span className="font-semibold text-[13.5px] text-[color:var(--ink-2)]">{name}</span>
            </span>
            <span>
              <StatusPill tone="active">פעיל</StatusPill>
            </span>
            <span className="text-[13px] text-ink-soft">{roleOf(name)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
