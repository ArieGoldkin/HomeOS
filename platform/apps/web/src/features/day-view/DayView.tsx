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
  /** Current time `HH:MM` — positions the NowLine. `null` on a non-today day (no NowLine). */
  nowTime: string | null;
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

  const hasTimed = timed.length > 0;
  const hasAside = untimed.length > 0 || tomorrow.length > 0;

  // Container-query layout: stack the timed column above the anytime rail on a narrow surface (the
  // phone "today" lives inside max-w-md), switch to side-by-side once the board is wide enough (the
  // tablet). Keyed off the DayView container's own width (@2xl/day ≈ 672px), not the viewport — so it
  // adapts even when a narrow phone column sits inside a wide window.
  return (
    <div className={cn("@container/day", className)}>
      <div className="flex flex-col gap-6 @2xl/day:flex-row @2xl/day:gap-8">
        {hasTimed && (
          <div className="min-w-0 @2xl/day:flex-1">
            <SectionHeader className="mb-3">{todayLabel}</SectionHeader>
            <TimeSpine events={timed} nowTime={nowTime} night={night} />
            {moreCount > 0 && (
              <p className="mt-3 text-[13px] text-muted-foreground">ועוד {moreCount}</p>
            )}
          </div>
        )}
        {hasAside && (
          <AnytimeSidebar
            // The divider only makes sense beside/under a timed column. Stacked: a top rule; side-by-
            // side (@2xl/day): a start rule + fixed rail width.
            className={cn(
              "w-full @2xl/day:w-56 @2xl/day:shrink-0",
              hasTimed &&
                "border-border border-t pt-6 @2xl/day:border-t-0 @2xl/day:border-s @2xl/day:pt-0 @2xl/day:ps-6",
            )}
            tasks={untimed}
            tomorrow={tomorrow}
            night={night}
          />
        )}
      </div>
    </div>
  );
}
