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
  tasksLabel?: string;
  tomorrowLabel?: string;
  night?: boolean;
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
  tasksLabel = "משימות להיום",
  tomorrowLabel = "מחר",
  night = false,
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
                <EventCard event={t} showTime={false} density="compact" night={night} />
              </div>
            ))}
          </div>
        </>
      )}

      {tomorrow.length > 0 && (
        <>
          <SectionHeader className={cn("mb-2", tasks.length > 0 && "mt-6")}>
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
