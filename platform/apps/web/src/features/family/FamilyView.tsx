import type { SavedEvent } from "@homeos/shared";
import { PersonAvatar } from "@shared/board";
import { useEvents, useFamily } from "@shared/hooks";
import { cn } from "@shared/lib";
import { Button, Card, Skeleton, StatusPill } from "@shared/ui";

const SKELETON_ROWS = ["sk1", "sk2", "sk3", "sk4"];

export interface FamilyViewProps {
  /** Called when the user activates the invite button. */
  onAddMember?: () => void;
  className?: string;
}

/**
 * #235 — the displayed role label stays a NAME-based parent/household heuristic. The server `role` is an
 * ownership axis ("owner"/"member"), NOT the parent-vs-household-member taxonomy the table shows (e.g. אמא
 * is a "member" by ownership but a "הורה"/parent here), so mapping the server role would mislabel her.
 */
function roleOf(name: string): string {
  return name === "אבא" || name === "אמא" ? "הורה" : "בן בית";
}

/** #235 — the roster = the server family members (names) UNION any distinct event assignees not already
 *  listed (so a person who only shows up as an assignee still appears). */
function rosterFrom(memberNames: string[], events: SavedEvent[] | undefined): string[] {
  const seen = new Set<string>(memberNames);
  const extra: string[] = [];
  for (const event of events ?? []) {
    const a = event.assignee;
    if (a && a !== "כולם" && !seen.has(a)) {
      seen.add(a);
      extra.push(a);
    }
  }
  return [...memberNames, ...extra];
}

/**
 * The People screen (#181) — the Modern "household" layout: kicker + heading + invite, a stat chip, and
 * a data table (avatar+name · status · role) per design-system §08. The roster derives from the known
 * names UNION any distinct event assignees. Status is a static placeholder ("פעיל") — real presence is
 * deferred (not server-backed); roles are a simple parent/member mapping.
 */
export function FamilyView({ onAddMember, className }: FamilyViewProps) {
  // #235 — roster names from the real GET /family route; events still supply any extra assignees.
  const { status, data: family } = useFamily();
  const { data: events } = useEvents();

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

  const members = rosterFrom(family?.members.map((m) => m.name) ?? [], events);

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
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-[var(--line)] border-b">
              <th className="w-1/2 px-5 py-3 text-start font-mono text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">
                שם
              </th>
              <th className="px-5 py-3 text-start font-mono text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">
                סטטוס
              </th>
              <th className="px-5 py-3 text-start font-mono text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">
                תפקיד
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((name, i) => (
              <tr
                key={name}
                className={cn(i < members.length - 1 && "border-[var(--line)] border-b")}
              >
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <PersonAvatar name={name} size={30} />
                    <span className="font-semibold text-[13.5px] text-[color:var(--ink-2)]">
                      {name}
                    </span>
                  </span>
                </td>
                <td className="px-5 py-3">
                  <StatusPill tone="active">פעיל</StatusPill>
                </td>
                <td className="px-5 py-3 text-[13px] text-ink-soft">{roleOf(name)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
