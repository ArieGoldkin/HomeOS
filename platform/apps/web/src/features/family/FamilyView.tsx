import { PersonAvatar } from "@shared/board";
import { useFamily } from "@shared/hooks";
import { cn } from "@shared/lib";
import { Button, Card, Skeleton } from "@shared/ui";

const SKELETON_ROWS = ["sk1", "sk2", "sk3", "sk4"];

export interface FamilyViewProps {
  /** Called when the user activates the invite button. */
  onAddMember?: () => void;
  className?: string;
}

/**
 * The role label from the server's ownership axis — the family owner vs a household member. That axis is the
 * ONLY role HomeOS actually stores (there is no parent-vs-child taxonomy), so we show it honestly rather than
 * guessing "parent" from a name.
 */
function roleLabel(role: string): string {
  return role === "owner" ? "בעלים" : "בן בית";
}

/**
 * The People screen (#181) — the "household" layout: kicker + heading + invite, a stat chip, and a data
 * table (avatar+name · role) per design-system §08. The roster is EXACTLY the real `GET /family` members
 * (no fabricated entries — previously it also unioned in distinct event-assignee names, which are NOT
 * members). Role is the server's owner/member axis; there is no fake presence status.
 */
export function FamilyView({ onAddMember, className }: FamilyViewProps) {
  const { status, data: family } = useFamily();

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

  const members = family?.members ?? [];

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
              <th className="w-2/3 px-5 py-3 text-start font-mono text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">
                שם
              </th>
              <th className="px-5 py-3 text-start font-mono text-[11px] font-medium text-muted-foreground uppercase tracking-[0.05em]">
                תפקיד
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, i) => (
              <tr
                key={member.name}
                className={cn(i < members.length - 1 && "border-[var(--line)] border-b")}
              >
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <PersonAvatar name={member.name} size={30} />
                    <span className="font-semibold text-[13.5px] text-[color:var(--ink-2)]">
                      {member.name}
                    </span>
                  </span>
                </td>
                <td className="px-5 py-3 text-[13px] text-ink-soft">{roleLabel(member.role)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
