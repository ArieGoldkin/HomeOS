import type { EventKind, SavedEvent } from "@homeos/shared";
import { assigneeColor, cn } from "@shared/lib";
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { PersonAvatar } from "./PersonAvatar";

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;

// The visual pip/checkbox are aria-hidden, so kind is also carried as screen-reader-only TEXT
// (DESIGN.md §13: convey kind by shape + text, never the marker alone). A plain event needs none.
const KIND_LABEL: Record<EventKind, string | null> = {
  event: null,
  task: "משימה",
  reminder: "תזכורת",
};

// Title text: display face (Rubik 500); reminder is primary-colored. Size adapts to the CARD's own
// width via the @container/card query (no media-breakpoint duplication); density is the explicit override.
const title = cva("min-w-0 font-display font-medium leading-[1.24]", {
  variants: {
    variant: {
      event: "text-foreground",
      task: "text-foreground",
      reminder: "text-primary",
    },
    density: {
      compact: "text-[16px] @[360px]/card:text-[18px]",
      comfortable: "text-[18px] @[360px]/card:text-[21px]",
    },
  },
  defaultVariants: { variant: "event", density: "comfortable" },
});

export interface EventCardProps extends HTMLAttributes<HTMLDivElement> {
  event: SavedEvent;
  /** Surface hint — sets the default density (phone → compact, else comfortable). */
  surface?: "tablet" | "phone" | "web";
  /** Explicit spacing override; falls back to the surface default. */
  density?: "compact" | "comfortable";
  /** Show the event's own time. TimeSpine sets false (the grid column owns the time). Default true. */
  showTime?: boolean;
  /** Night-optimized assignee color (the always-on tablet runs night). */
  night?: boolean;
}

/**
 * THE primary data unit, reused verbatim across tablet/phone/web — accepts a {@link SavedEvent} directly
 * (no DTO). `kind` is encoded by FORM, never a colored left-border (DESIGN.md §12 ban #1): reminder = a
 * leading ocean pip + primary-colored title; task = a checkbox square; event = no marker. The anti-slop
 * regression test in EventCard.test.tsx is the canonical contract.
 */
export function EventCard({
  event,
  surface,
  density,
  showTime = true,
  night = false,
  className,
  ...props
}: EventCardProps) {
  const variant = event.kind; // "event" | "task" | "reminder"
  const spacing = density ?? (surface === "phone" ? "compact" : "comfortable");
  const assigneeHex = event.assignee
    ? assigneeColor(event.assignee)[night ? "night" : "light"]
    : undefined;

  return (
    <div className={cn("@container/card min-w-0", className)} {...props}>
      <div className="flex items-baseline gap-2">
        {variant === "reminder" && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 self-center rounded-full bg-primary"
          />
        )}
        {variant === "task" && (
          <span
            aria-hidden="true"
            className="mt-0.5 size-[15px] shrink-0 rounded-md border-[1.5px] border-input"
          />
        )}
        {KIND_LABEL[variant] && <span className="sr-only">{KIND_LABEL[variant]}: </span>}
        <span className={title({ variant, density: spacing })}>{event.title_he}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
        {showTime && event.time && (
          <span dir="ltr" className="tabular-nums text-muted-foreground">
            {event.time}
          </span>
        )}
        {event.assignee && (
          <span
            className="inline-flex items-center gap-1.5 font-semibold"
            style={{ color: assigneeHex }}
          >
            <PersonAvatar name={event.assignee} size={20} night={night} />
            {event.assignee}
          </span>
        )}
        {event.location && <span className="text-muted-foreground">{event.location}</span>}
        {event.recurrence && (
          <span className="text-muted-foreground">↻ {HE_DAYS[event.recurrence.weekday]}</span>
        )}
      </div>
    </div>
  );
}
