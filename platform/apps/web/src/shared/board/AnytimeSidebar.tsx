import type { SavedEvent } from "@homeos/shared";
import { cn } from "@shared/lib";
import { EventCard } from "./EventCard";
import { PeekRow } from "./PeekRow";
import { SectionHeader } from "./SectionHeader";

export interface PeekItem {
  time?: string | null;
  title: string;
}

export interface AnytimeSidebarProps {
  /** Untimed items for today (rendered as task-variant EventCards). */
  tasks: SavedEvent[];
  /** A quiet preview of tomorrow (rendered as PeekRows). */
  tomorrow: PeekItem[];
  /** #284 — standing daily reminders due today (the "קבוע" group; reminders, so no done-toggle). */
  standing?: SavedEvent[];
  tasksLabel?: string;
  tomorrowLabel?: string;
  standingLabel?: string;
  /** #153 — pass-through to the untimed task EventCards (the tomorrow PeekRows are previews, not openable). */
  onOpenDetail?: (event: SavedEvent) => void;
  /** #19 — pass-through: when set, a task card's checkbox toggles open/done. */
  onToggleDone?: (event: SavedEvent) => void;
  className?: string;
}

/**
 * The tablet board's side rail: "anytime today" untimed tasks (checkbox EventCards) above a quiet
 * "tomorrow" peek. Composes the #93 SectionHeader + PeekRow atoms and the #94 EventCard, so the same
 * card renders identically here and in the time-spine.
 */
export function AnytimeSidebar({
  tasks,
  tomorrow,
  standing = [],
  tasksLabel = "משימות להיום",
  tomorrowLabel = "מחר",
  standingLabel = "קבוע",
  onOpenDetail,
  onToggleDone,
  className,
}: AnytimeSidebarProps) {
  return (
    <aside className={cn("flex flex-col", className)}>
      {tasks.length > 0 && (
        <>
          <SectionHeader className="mb-3">{tasksLabel}</SectionHeader>
          <div>
            {tasks.map((t) => (
              <div key={t.id} className="border-border border-t py-2.5">
                <EventCard
                  event={t}
                  showTime={false}
                  density="compact"
                  onOpenDetail={onOpenDetail}
                  onToggleDone={onToggleDone}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {standing.length > 0 && (
        <>
          <SectionHeader className={cn("mb-3", tasks.length > 0 && "mt-6")}>
            {standingLabel}
          </SectionHeader>
          <div>
            {standing.map((s) => (
              <div key={s.id} className="border-border border-t py-2.5">
                {/* #284 — standing reminders CAN be timed ("כדור ב-08:00 באופן קבוע"); show the time so
                    the board matches the digest (which shows it) and the time-then-title sort is honest. */}
                <EventCard event={s} density="compact" onOpenDetail={onOpenDetail} />
              </div>
            ))}
          </div>
        </>
      )}

      {tomorrow.length > 0 && (
        <>
          <SectionHeader
            className={cn("mb-2", (tasks.length > 0 || standing.length > 0) && "mt-6")}
          >
            {tomorrowLabel}
          </SectionHeader>
          <div>
            {tomorrow.map((p) => (
              <PeekRow key={`${p.time ?? ""}-${p.title}`} time={p.time ?? null} title={p.title} />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
