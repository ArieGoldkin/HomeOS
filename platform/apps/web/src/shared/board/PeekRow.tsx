import { cn } from "@shared/lib";
import type { HTMLAttributes } from "react";

export interface PeekRowProps extends HTMLAttributes<HTMLDivElement> {
  /** `HH:MM` (24h), or null for an untimed item (renders an em-dash). */
  time?: string | null;
  title: string;
}

/**
 * A quiet "tomorrow peek" / anytime ledger row: an LTR tabular-nums time followed by a title, on a
 * hairline divider (DESIGN.md "designed almanac" look). Muted by default — the peek is a glance, not
 * a focus. Logical properties only so it mirrors correctly under RTL.
 */
export function PeekRow({ time, title, className, ...props }: PeekRowProps) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2.5 border-border border-t py-[7px] text-[14px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span dir="ltr" className="shrink-0 tabular-nums">
        {time ?? "—"}
      </span>
      <span className="min-w-0 truncate">{title}</span>
    </div>
  );
}
