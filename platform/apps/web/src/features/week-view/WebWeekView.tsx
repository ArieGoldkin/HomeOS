import type { SavedEvent } from "@homeos/shared";
import { useWeekDays } from "@shared/hooks";
import { Skeleton } from "@shared/ui";
import { WeekGrid } from "./components/WeekGrid";

const SKELETON_COLS = ["c0", "c1", "c2", "c3", "c4", "c5", "c6"];

export interface WebWeekViewProps {
  /** The anchor date `YYYY-MM-DD` — determines which Sunday-start week to show. */
  dateIso: string;
  /** Called with a day's ISO date when its column header is tapped. No router — the controller wires it. */
  onSelectDate: (dateIso: string) => void;
  /** #153 — when set, the week's EventCards open the detail drawer (phone/web only; never the kiosk). */
  onOpenDetail?: (event: SavedEvent) => void;
}

/**
 * Data-connected web week surface: the shared `useWeekDays` feeding a 7-column `WeekGrid`. The web
 * counterpart to the phone `WeekView` (which renders a vertical `WeekList` from the same hook). Handles
 * loading (7 skeleton columns) and error (muted Hebrew message).
 */
export function WebWeekView({ dateIso, onSelectDate, onOpenDetail }: WebWeekViewProps) {
  const { status, days, rangeLabel } = useWeekDays(dateIso);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-5 w-32">
          <Skeleton variant="line" className="w-full" />
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border">
          {SKELETON_COLS.map((k) => (
            <div key={k} className="min-h-[8rem] bg-card p-2">
              <Skeleton variant="line" className="w-10" />
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
      <WeekGrid days={days} onSelectDate={onSelectDate} onOpenDetail={onOpenDetail} />
    </div>
  );
}
