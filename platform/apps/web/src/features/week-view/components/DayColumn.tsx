import type { SavedEvent } from "@homeos/shared";
import { EventCard } from "@shared/board";
import { cn } from "@shared/lib";

export interface DayColumnProps {
  /** ISO date `YYYY-MM-DD` for this column. */
  dateIso: string;
  /** Hebrew weekday label, e.g. "ראשון". */
  weekdayLabel: string;
  /** Day-of-month number as a string, e.g. "21". */
  dayLabel: string;
  /** #25 — Hebrew calendar date, e.g. "19 חשון". */
  hebrewDate?: string;
  /** #25 — major Israeli holiday name(s) on this day (Hebrew). */
  holidays?: string[];
  /** Events on this day. */
  events: SavedEvent[];
  /** Whether this day is today — applies the ocean accent + ring. */
  isToday?: boolean;
  /** Called with this column's `dateIso` when the header is tapped. */
  onSelect?: (dateIso: string) => void;
  /** #153 — when set, each EventCard opens the detail drawer; omitted ⇒ inert cards. */
  onOpenDetail?: (event: SavedEvent) => void;
}

/**
 * One day cell in the web {@link WeekGrid}: a tappable header (weekday + day number, ocean accent +
 * inset ring when today) over a vertical stack of compact EventCards (or an em-dash when empty). Pure —
 * no data fetching. EventCard adapts to the narrow column via its own `@container/card` query.
 */
export function DayColumn({
  dateIso,
  weekdayLabel,
  dayLabel,
  hebrewDate,
  holidays,
  events,
  isToday = false,
  onSelect,
  onOpenDetail,
}: DayColumnProps) {
  return (
    <div
      className={cn(
        "flex min-h-[10rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--card-border)] bg-card shadow-card",
        isToday && "ring-1 ring-inset ring-primary",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect?.(dateIso)}
        className="flex items-baseline justify-between gap-1 px-2 py-2 text-start transition-colors hover:bg-secondary/60"
      >
        <span
          className={cn("font-medium text-[13px]", isToday ? "text-primary" : "text-foreground")}
        >
          {weekdayLabel}
        </span>
        <span
          dir="ltr"
          className={cn(
            "tabular-nums text-[13px]",
            isToday ? "font-semibold text-primary" : "text-muted-foreground",
          )}
        >
          {dayLabel}
        </span>
      </button>

      {(hebrewDate || (holidays?.length ?? 0) > 0) && (
        <div className="px-2 pb-1">
          {hebrewDate && (
            <div className="text-[10px] text-muted-foreground leading-tight">{hebrewDate}</div>
          )}
          {holidays?.map((name) => (
            <div
              key={name}
              dir="rtl"
              title={name}
              className="truncate font-medium text-[11px] text-primary leading-tight"
            >
              {name}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1.5 px-1.5 pb-2">
        {events.length === 0 ? (
          <span className="px-0.5 text-[13px] text-muted-foreground" aria-hidden="true">
            —
          </span>
        ) : (
          events.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              surface="web"
              density="compact"
              onOpenDetail={onOpenDetail}
            />
          ))
        )}
      </div>
    </div>
  );
}
