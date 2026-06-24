import type { SavedEvent } from "@homeos/shared";
import { cn } from "@shared/lib";
import { Fragment } from "react";
import { EventCard } from "./EventCard";
import { NowLine } from "./NowLine";

export interface TimeSpineProps {
  events: SavedEvent[];
  /** Current time as `HH:MM`; when set, a NowLine is injected at its position. */
  nowTime?: string | null;
  density?: "compact" | "comfortable";
  /** Pass-through to each EventCard: when set, cards open the detail drawer; omitted ⇒ inert (presentational). */
  onOpenDetail?: (event: SavedEvent) => void;
  /** #19 — pass-through: when set, a task card's checkbox toggles open/done. */
  onToggleDone?: (event: SavedEvent) => void;
  className?: string;
}

/**
 * The tablet time-spine: an `auto 1fr` grid of (LTR tabular time-label, EventCard) rows on hairline
 * dividers, with a NowLine injected at the current time. Only timed events appear here — untimed ones
 * live in the AnytimeSidebar. EventCards run with `showTime={false}` since the grid column owns the time.
 */
export function TimeSpine({
  events,
  nowTime = null,
  density = "comfortable",
  onOpenDetail,
  onToggleDone,
  className,
}: TimeSpineProps) {
  // localeCompare is a correct chronological sort here because the shared `timeHm` schema guarantees
  // zero-padded 24h `HH:MM`, so lexical order == time order.
  const timed = events
    .filter((e) => e.time != null)
    .sort((a, b) => (a.time as string).localeCompare(b.time as string));
  const rowPad = density === "compact" ? "py-2" : "py-3";
  // first event at/after now → the NowLine sits just before it; -1 → now is after every event
  const nowIdx = nowTime == null ? -1 : timed.findIndex((e) => (e.time as string) >= nowTime);

  const nowRow = (
    <>
      <div className="border-border border-t" />
      <div className={cn("border-border border-t", rowPad)}>
        <NowLine time={nowTime as string} />
      </div>
    </>
  );

  return (
    <div className={cn("grid grid-cols-[auto_1fr] gap-x-[18px]", className)}>
      {timed.map((e, i) => (
        <Fragment key={e.id}>
          {nowTime != null && i === nowIdx && nowRow}
          <div
            className={cn(
              "whitespace-nowrap border-border border-t font-semibold text-[16px] text-muted-foreground tabular-nums",
              rowPad,
            )}
          >
            <span dir="ltr">{e.time}</span>
          </div>
          <div className={cn("border-border border-t", rowPad)}>
            <EventCard
              event={e}
              showTime={false}
              density={density}
              onOpenDetail={onOpenDetail}
              onToggleDone={onToggleDone}
            />
          </div>
        </Fragment>
      ))}
      {nowTime != null && nowIdx === -1 && timed.length > 0 && nowRow}
    </div>
  );
}
