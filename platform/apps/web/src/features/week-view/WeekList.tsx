import type { SavedEvent } from "@homeos/shared";
import { DayRow } from "./DayRow";

export interface WeekDay {
  dateIso: string;
  weekdayLabel: string;
  dayLabel: string;
  events: SavedEvent[];
  isToday: boolean;
  isSelected: boolean;
}

export interface WeekListProps {
  /** The 7 days of the week, Sunday → Saturday. */
  days: WeekDay[];
  /** Called with the tapped day's ISO date. */
  onSelectDate: (dateIso: string) => void;
}

/**
 * A RTL card list of 7 `DayRow`s with dividers — Sunday to Saturday in DOM order.
 * Pure: no data fetching, no router.
 */
export function WeekList({ days, onSelectDate }: WeekListProps) {
  return (
    <div
      dir="rtl"
      className="rounded-[var(--radius)] bg-card border border-border divide-y divide-border overflow-hidden"
    >
      {days.map((day) => (
        <DayRow
          key={day.dateIso}
          dateIso={day.dateIso}
          weekdayLabel={day.weekdayLabel}
          dayLabel={day.dayLabel}
          events={day.events}
          isToday={day.isToday}
          isSelected={day.isSelected}
          onSelect={onSelectDate}
        />
      ))}
    </div>
  );
}
