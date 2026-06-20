import type { SavedEvent } from "@homeos/shared";
import { useEvents, useNow } from "@shared/hooks";
import { addDaysIso, jerusalemTodayIso, startOfWeekSundayIso } from "@shared/lib";
import { Skeleton } from "@shared/ui";
import { WeekList } from "./WeekList";

/** Hebrew weekday labels: index 0 = Sunday … 6 = Saturday. */
const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

const SKELETON_ROWS = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];

export interface WeekViewProps {
  /** The currently selected / anchor date `YYYY-MM-DD` — determines which week to show. */
  dateIso: string;
  /** Called with an ISO date when the user taps a day row. No router — the controller wires this. */
  onSelectDate: (dateIso: string) => void;
}

/**
 * Data-connected week surface for the phone. Derives the 7-day range from `dateIso` (week starts
 * Sunday per the Israeli calendar), groups `GET /events` data by date, and renders a `WeekList`.
 * Handles loading (7 skeleton rows) and error (muted Hebrew message). Night = false (phone = day theme).
 */
export function WeekView({ dateIso, onSelectDate }: WeekViewProps) {
  const now = useNow();
  const { data, isLoading, isError } = useEvents();

  const weekStart = startOfWeekSundayIso(dateIso);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));

  // Build a lookup: date_iso → events
  const eventsByDate = new Map<string, SavedEvent[]>();
  if (data) {
    for (const ev of data) {
      const bucket = eventsByDate.get(ev.date_iso) ?? [];
      bucket.push(ev);
      eventsByDate.set(ev.date_iso, bucket);
    }
  }

  const today = jerusalemTodayIso(now);

  // Derive week range label from the first day's month (and year if cross-year)
  const firstDate = new Date(`${weekDays[0]}T00:00:00Z`);
  const lastDate = new Date(`${weekDays[6]}T00:00:00Z`);
  const monthFmt = new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const firstMonth = new Intl.DateTimeFormat("he-IL", {
    month: "long",
    timeZone: "UTC",
  }).format(firstDate);
  const rangeLabel =
    firstDate.getUTCMonth() === lastDate.getUTCMonth()
      ? monthFmt.format(firstDate)
      : `${firstMonth} – ${monthFmt.format(lastDate)}`;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-5 mb-2 w-32">
          <Skeleton variant="line" className="w-full" />
        </div>
        <div className="rounded-[var(--radius)] bg-card border border-border divide-y divide-border overflow-hidden">
          {SKELETON_ROWS.map((k) => (
            <div key={k} className="flex items-center px-4 py-3 gap-3 min-h-[44px]">
              <Skeleton variant="line" className="w-16" />
              <Skeleton variant="line" className="w-24 ms-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return <p className="text-muted-foreground text-sm">שגיאה בטעינת השבוע — ננסה שוב בקרוב.</p>;
  }

  const days = weekDays.map((day, i) => ({
    dateIso: day,
    weekdayLabel: HE_WEEKDAYS[i] ?? "",
    dayLabel: String(new Date(`${day}T00:00:00Z`).getUTCDate()),
    events: eventsByDate.get(day) ?? [],
    isToday: day === today,
    isSelected: day === dateIso,
  }));

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[13px] font-medium text-muted-foreground px-1">{rangeLabel}</h2>
      <WeekList days={days} onSelectDate={onSelectDate} />
    </div>
  );
}
