import { useWeekDays } from "@shared/hooks";
import { Skeleton } from "@shared/ui";
import { WeekList } from "./WeekList";

const SKELETON_ROWS = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];

export interface WeekViewProps {
  /** The currently selected / anchor date `YYYY-MM-DD` — determines which week to show. */
  dateIso: string;
  /** Called with an ISO date when the user taps a day row. No router — the controller wires this. */
  onSelectDate: (dateIso: string) => void;
}

/**
 * Data-connected week surface for the phone. Reads the Sunday-start week from the shared `useWeekDays`
 * hook (one source of truth, shared with the web `WeekGridView`) and renders a vertical `WeekList`.
 * Handles loading (7 skeleton rows) and error (muted Hebrew message). Night = false (phone = day theme).
 */
export function WeekView({ dateIso, onSelectDate }: WeekViewProps) {
  const { status, days, rangeLabel } = useWeekDays(dateIso);

  if (status === "loading") {
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

  if (status === "error") {
    return <p className="text-muted-foreground text-sm">שגיאה בטעינת השבוע — ננסה שוב בקרוב.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[13px] font-medium text-muted-foreground px-1">{rangeLabel}</h2>
      <WeekList days={days} onSelectDate={onSelectDate} />
    </div>
  );
}
