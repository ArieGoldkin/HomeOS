import type { SavedEvent } from "@homeos/shared";
import { AnytimeSidebar, type PeekItem, SectionHeader, TimeSpine } from "@shared/board";
import { cn } from "@shared/lib";
import { Skeleton } from "@shared/ui";

export type DayViewStatus = "loading" | "error" | "ready";

export interface DayViewProps {
  status: DayViewStatus;
  /** Today's timed events (already curated to what fits — the tablet never scrolls). */
  timed: SavedEvent[];
  /** Today's untimed events. */
  untimed: SavedEvent[];
  /** Tomorrow's peek rows. */
  tomorrow: PeekItem[];
  /** Current time `HH:MM` — positions the NowLine. */
  nowTime: string;
  /** How many timed events were curated away (drives the "+N more" cue). */
  moreCount?: number;
  night?: boolean;
  todayLabel?: string;
  className?: string;
}

const SKELETON_ROWS = ["s1", "s2", "s3", "s4"];

/**
 * The day's board content — TimeSpine (timed) beside an AnytimeSidebar (untimed + tomorrow). Pure and
 * surface-agnostic: it takes already-fetched, already-curated data + a clock, so the same view drives
 * the tablet now and web-today later. Handles loading (ink-not-dry skeletons), error, and empty.
 */
export function DayView({
  status,
  timed,
  untimed,
  tomorrow,
  nowTime,
  moreCount = 0,
  night = false,
  todayLabel = "היום",
  className,
}: DayViewProps) {
  if (status === "loading") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {SKELETON_ROWS.map((k) => (
          <Skeleton key={k} variant="line" className="w-full" />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>
        שגיאה בטעינת הלוח — ננסה שוב בקרוב.
      </p>
    );
  }

  if (timed.length === 0 && untimed.length === 0 && tomorrow.length === 0) {
    return <p className={cn("text-muted-foreground", className)}>אין אירועים היום ✦</p>;
  }

  return (
    <div className={cn("flex gap-8", className)}>
      <div className="min-w-0 flex-1">
        <SectionHeader className="mb-3">{todayLabel}</SectionHeader>
        <TimeSpine events={timed} nowTime={nowTime} night={night} />
        {moreCount > 0 && (
          <p className="mt-3 text-[13px] text-muted-foreground">ועוד {moreCount}</p>
        )}
      </div>
      <AnytimeSidebar
        className="w-56 shrink-0 border-border border-s ps-6"
        tasks={untimed}
        tomorrow={tomorrow}
        night={night}
      />
    </div>
  );
}
