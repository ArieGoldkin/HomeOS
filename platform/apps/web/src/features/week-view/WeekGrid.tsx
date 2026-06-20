import type { WeekDay } from "@shared/hooks";
import { cn } from "@shared/lib";
import { DayColumn } from "./DayColumn";

export interface WeekGridProps {
  /** Seven days, Sunday → Saturday in DOM order. The RTL surface lays them out right-to-left. */
  days: WeekDay[];
  /** Called with a day's ISO date when its header is tapped. */
  onSelectDate?: (dateIso: string) => void;
  className?: string;
}

/**
 * The web week layout: a 7-column grid of {@link DayColumn} cells. Days are supplied Sunday→Saturday in
 * DOM order; under the app's `dir="rtl"` the grid renders them right-to-left, so Sunday sits on the
 * RIGHT and Saturday on the left. Hairline grid lines come from the `gap-px` + `bg-border` trick (each
 * cell is `bg-card`). The visual right-to-left x-order is a browser-layout property — jsdom has no
 * layout engine, so it's verified at the Playwright milestone; the unit test asserts the DOM order
 * [Sun..Sat] that drives it.
 */
export function WeekGrid({ days, onSelectDate, className }: WeekGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-7 gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border",
        className,
      )}
    >
      {days.map((d) => (
        <DayColumn
          key={d.dateIso}
          dateIso={d.dateIso}
          weekdayLabel={d.weekdayLabel}
          dayLabel={d.dayLabel}
          events={d.events}
          isToday={d.isToday}
          onSelect={onSelectDate}
        />
      ))}
    </div>
  );
}
