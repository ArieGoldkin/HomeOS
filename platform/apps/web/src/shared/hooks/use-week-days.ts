import type { SavedEvent } from "@homeos/shared";
import { addDaysIso, jerusalemTodayIso, startOfWeekSundayIso } from "@shared/lib";
import { useEvents } from "./use-events";
import { useNow } from "./use-now";

/** Hebrew weekday labels: index 0 = Sunday … 6 = Saturday (Israeli week). */
const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

/** One day of the Sunday-start week, with its events bucketed and today/selected flags resolved. */
export interface WeekDay {
  dateIso: string;
  weekdayLabel: string;
  dayLabel: string;
  events: SavedEvent[];
  isToday: boolean;
  isSelected: boolean;
}

export interface WeekDays {
  status: "loading" | "error" | "ready";
  /** Seven days, Sunday → Saturday (DOM order; the RTL surface lays them out right-to-left). */
  days: WeekDay[];
  /** Hebrew month/year label for the week range (spans two months when it crosses a boundary). */
  rangeLabel: string;
}

/**
 * Shared week-data source for both week surfaces: the phone `WeekView` (vertical `WeekList`) and the
 * web `WeekGridView` (7-column `WeekGrid`). Derives the Sunday-start week from `dateIso`, buckets
 * `GET /events` by date, and resolves today/selected flags — so neither surface re-implements the
 * grouping (the single source of truth for "what's this week").
 */
export function useWeekDays(dateIso: string): WeekDays {
  const now = useNow();
  const { data, isLoading, isError } = useEvents();

  const weekStart = startOfWeekSundayIso(dateIso);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));

  const eventsByDate = new Map<string, SavedEvent[]>();
  if (data) {
    for (const ev of data) {
      const bucket = eventsByDate.get(ev.date_iso) ?? [];
      bucket.push(ev);
      eventsByDate.set(ev.date_iso, bucket);
    }
  }

  const today = jerusalemTodayIso(now);

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

  const days: WeekDay[] = weekDays.map((day, i) => ({
    dateIso: day,
    weekdayLabel: HE_WEEKDAYS[i] ?? "",
    dayLabel: String(new Date(`${day}T00:00:00Z`).getUTCDate()),
    events: eventsByDate.get(day) ?? [],
    isToday: day === today,
    isSelected: day === dateIso,
  }));

  const status = isLoading ? "loading" : isError ? "error" : "ready";

  return { status, days, rangeLabel };
}
