import type { WeekDay } from "@shared/hooks";
import { cn } from "@shared/lib";

/** #283 — dots per day are capped: the strip answers "is something there?", not "how much". */
const DOT_CAP = 3;

export interface WeekStripProps {
  /** Seven days, Sunday → Saturday in DOM order — `dir=rtl` lays Sunday rightmost; never reversed. */
  days: WeekDay[];
  /** Called with the tapped day's `dateIso`; omitted ⇒ the cells are inert. */
  onSelectDay?: (dateIso: string) => void;
}

/**
 * #283 — the 7-day mini-strip atop Today: day-hop without leaving home. Each cell is a 44px button
 * showing the day number over up to {@link DOT_CAP} quiet dots; today carries `aria-current="date"`,
 * the displayed day a chip ring + "(מוצג)" in its accessible name. Presentational — no data fetching
 * (TodayScreen feeds it from the shared `useWeekDays`).
 */
export function WeekStrip({ days, onSelectDay }: WeekStripProps) {
  return (
    <nav aria-label="קפיצה לימי השבוע" className="grid grid-cols-7 gap-1">
      {days.map((day) => (
        <button
          key={day.dateIso}
          type="button"
          aria-current={day.isToday ? "date" : undefined}
          aria-label={`${day.weekdayLabel} ${day.dayLabel}${day.isSelected ? " (מוצג)" : ""}`}
          onClick={() => onSelectDay?.(day.dateIso)}
          className={cn(
            "flex min-h-11 flex-col items-center justify-center gap-1 rounded-sm transition-colors hover:bg-secondary/60",
            day.isSelected && "bg-[var(--chip-bg)] ring-1 ring-[var(--chip-border)] ring-inset",
          )}
        >
          <span
            dir="ltr"
            className={cn(
              "tabular-nums text-[13px]",
              day.isToday ? "font-semibold text-primary" : "text-muted-foreground",
            )}
          >
            {day.dayLabel}
          </span>
          <span className="flex h-1 items-center gap-0.5" aria-hidden="true">
            {day.events.slice(0, DOT_CAP).map((ev) => (
              <span key={ev.id} className="size-1 rounded-full bg-[var(--ink-faint)]" />
            ))}
          </span>
        </button>
      ))}
    </nav>
  );
}
