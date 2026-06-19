import { cn } from "@shared/lib";
import type { HTMLAttributes } from "react";

export interface NowLineProps extends HTMLAttributes<HTMLDivElement> {
  /** Current time as `HH:MM` (24h). Rendered dir=ltr + tabular-nums. */
  time: string;
  /** Leading word before the time. Defaults to `now`; the Hebrew tablet passes `עכשיו`. */
  label?: string;
}

/**
 * The ambient NOW marker on the tablet time-spine: an ocean 1.5px rule (the `.now-line` signature)
 * with an inline `{label} · HH:MM` caption. The caption is wrapped dir=ltr + tabular-nums so the time
 * reads as a clean ledger value even inside the RTL board (issue #93 test note).
 */
export function NowLine({ time, label = "now", className, ...props }: NowLineProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <span dir="ltr" className="shrink-0 font-semibold text-[11px] text-primary tabular-nums">
        {label} · {time}
      </span>
      <span aria-hidden="true" className="now-line grow" />
    </div>
  );
}
