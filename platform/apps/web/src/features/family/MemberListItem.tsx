import { PersonAvatar } from "@shared/board";
import { cn } from "@shared/lib";
import { StatusDot } from "./StatusDot";

export interface MemberListItemProps {
  /** Family member name — drives avatar color and display. */
  name: string;
  /** Optional subtitle (e.g. role or status text). Muted, 13px. */
  subtitle?: string;
  /** Whether this member is currently online. */
  online?: boolean;
  className?: string;
}

/**
 * A single family-roster row: avatar + name (bold) + optional subtitle + a presence dot.
 * Pure — no data fetching. 44px min height satisfies the phone tap-target requirement.
 */
export function MemberListItem({ name, subtitle, online = false, className }: MemberListItemProps) {
  return (
    <div className={cn("flex min-h-11 items-center gap-3 py-1", className)}>
      <PersonAvatar name={name} size={36} night={false} />

      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug text-foreground">{name}</p>
        {subtitle && <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>

      <StatusDot online={online} />
    </div>
  );
}
