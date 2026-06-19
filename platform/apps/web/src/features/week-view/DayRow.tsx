import type { SavedEvent } from "@homeos/shared";
import { assigneeColor, cn } from "@shared/lib";
import { Pip } from "./Pip";

/** Max number of pips shown before a "+N" overflow label. */
const MAX_PIPS = 5;

export interface DayRowProps {
  /** ISO date `YYYY-MM-DD` for this row. */
  dateIso: string;
  /** Hebrew weekday label, e.g. "ראשון". */
  weekdayLabel: string;
  /** Day-of-month number as a string, e.g. "21". */
  dayLabel: string;
  /** Events on this day. */
  events: SavedEvent[];
  /** Whether this day is today — applies ocean accent + "היום" hint. */
  isToday?: boolean;
  /** Whether this day is the currently selected date — applies bg-secondary. */
  isSelected?: boolean;
  /** Called with the row's `dateIso` when the row is tapped. */
  onSelect: (dateIso: string) => void;
}

/**
 * A single tappable week-row: weekday label + day number on the start side,
 * event pips (or em-dash) on the end side. Pure — no data fetching.
 */
export function DayRow({
  dateIso,
  weekdayLabel,
  dayLabel,
  events,
  isToday = false,
  isSelected = false,
  onSelect,
}: DayRowProps) {
  const visibleEvents = events.slice(0, MAX_PIPS);
  const overflowCount = events.length - visibleEvents.length;

  return (
    <button
      type="button"
      onClick={() => onSelect(dateIso)}
      className={cn(
        "flex w-full min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-start transition-colors",
        "hover:bg-secondary/60 active:bg-secondary",
        isSelected && "bg-secondary",
      )}
    >
      {/* Start side: weekday + day number */}
      <span className="flex items-baseline gap-2 min-w-0">
        <span
          className={cn(
            "font-medium text-[15px] shrink-0",
            isToday ? "text-primary" : "text-foreground",
          )}
        >
          {weekdayLabel}
        </span>
        {isToday && <span className="text-[11px] text-primary font-medium shrink-0">היום</span>}
        <span
          dir="ltr"
          className={cn(
            "tabular-nums text-[14px] shrink-0",
            isToday ? "text-primary font-semibold" : "text-muted-foreground",
          )}
        >
          {dayLabel}
        </span>
      </span>

      {/* End side: pips or em-dash */}
      <span className="flex items-center gap-1 shrink-0">
        {events.length === 0 ? (
          <span className="text-muted-foreground text-[15px]" aria-hidden="true">
            —
          </span>
        ) : (
          <>
            {visibleEvents.map((ev) => (
              <Pip key={ev.id} color={assigneeColor(ev.assignee).light} />
            ))}
            {overflowCount > 0 && (
              <span className="text-[12px] text-muted-foreground ms-0.5">+{overflowCount}</span>
            )}
          </>
        )}
      </span>
    </button>
  );
}
