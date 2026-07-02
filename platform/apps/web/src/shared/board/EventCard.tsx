import type { EventKind, SavedEvent } from "@homeos/shared";
import { assigneeColor, cn } from "@shared/lib";
import { useThemeMode } from "@shared/theme";
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { PersonAvatar } from "./PersonAvatar";
import { ProviderBadge } from "./ProviderBadge";

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

// HTMLElement (not HTMLDivElement) so the same props spread cleanly onto the inert <div> AND the
// interactive <button> branch — mirroring PersonChip's polymorphic display→button shape (#153/F1).
export interface EventCardProps extends HTMLAttributes<HTMLElement> {
  event: SavedEvent;
  /** Surface hint — sets the default density (phone → compact, else comfortable). */
  surface?: "tablet" | "phone" | "web";
  /** Explicit spacing override; falls back to the surface default. */
  density?: "compact" | "comfortable";
  /** Show the event's own time. TimeSpine sets false (the grid column owns the time). Default true. */
  showTime?: boolean;
  /**
   * When provided, the card becomes an interactive `<button>` that opens the event-detail drawer (mirrors
   * PersonChip's display→button polymorphism); omitted ⇒ the card stays a pure, inert `<div>`. This is a
   * PRESENTATIONAL contract — a card is interactive only where a screen wires a detail host — not a
   * security boundary (#184: the ambient surface this once gated no longer exists).
   */
  onOpenDetail?: (event: SavedEvent) => void;
  /**
   * #19 — when provided AND the card is a `task`, the leading checkbox becomes an interactive
   * `<button role="checkbox">` that toggles open/done. The checkbox renders as a SIBLING of the
   * (optional) detail button — never nested — so the HTML stays valid. Omitted ⇒ the marker is the
   * decorative `<span>` as before. Done-state styling (struck-through title + filled box) is derived
   * from `event.status` and applies on EVERY surface, with or without this handler.
   */
  onToggleDone?: (event: SavedEvent) => void;
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
  onOpenDetail,
  onToggleDone,
  className,
  ...props
}: EventCardProps) {
  const variant = event.kind; // "event" | "task" | "reminder"
  const spacing = density ?? (surface === "phone" ? "compact" : "comfortable");
  const mode = useThemeMode();
  const assigneeHex = event.assignee
    ? assigneeColor(event.assignee)[mode === "dark" ? "night" : "light"]
    : undefined;
  // #19 — done-state is derived from the served row, so a completed task reads struck-through on EVERY
  // surface (week grid, peeks), not only where the toggle is wired. Absent status ⇒ open (legacy rows).
  const isDone = event.status === "done";

  // #19 — the task box (filled ✓ when done, empty bordered box when open); shared by the decorative
  // marker and the interactive checkbox button so they look identical.
  const taskBoxClass = cn(
    "grid size-[15px] shrink-0 place-items-center rounded-md border-[1.5px] text-[10px] leading-none",
    isDone ? "border-primary bg-primary text-primary-foreground" : "border-input",
  );

  const titleNode = (
    <span
      className={cn(
        title({ variant, density: spacing }),
        isDone && "text-muted-foreground line-through",
      )}
    >
      {event.title_he}
    </span>
  );

  const meta = (
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
          <PersonAvatar name={event.assignee} size={20} />
          {event.assignee}
        </span>
      )}
      {event.location && <span className="text-muted-foreground">{event.location}</span>}
      {event.recurrence && (
        <span className="text-muted-foreground">
          <span aria-hidden="true">↻</span> {HE_DAYS[event.recurrence.weekday]}
        </span>
      )}
      {/* #284 — the standing-daily marker, the SAME "(יומי)" vocabulary the bot confirm + digest use. */}
      {event.standing?.cadence === "daily" && <span className="text-muted-foreground">(יומי)</span>}
      <ProviderBadge source={event.source} />
    </div>
  );

  // #19 — interactive done-toggle (tasks only). The checkbox is its OWN <button> and a SIBLING of the
  // optional detail button — never nested (a button-in-button is invalid HTML). The card body carries
  // no leading marker here (the checkbox button is it).
  if (onToggleDone && variant === "task") {
    const content = (
      <>
        <div className="flex items-baseline gap-2">
          <span className="sr-only">{KIND_LABEL.task}: </span>
          {titleNode}
        </div>
        {meta}
      </>
    );
    return (
      <div {...props} className={cn("@container/card flex min-w-0 items-start gap-2.5", className)}>
        {/* biome-ignore lint/a11y/useSemanticElements: a native <input type=checkbox> can't render the
            custom bordered box + ✓ glyph; a <button role=checkbox aria-checked> is the ARIA-equivalent
            styled toggle (mirrors PersonChip's button+aria-pressed pattern). */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isDone}
          // F1 — include the title so each checkbox has a DISTINCT accessible name on a multi-task board.
          aria-label={`${isDone ? "בטל סימון בוצע" : "סמן כבוצע"}: ${event.title_he}`}
          onClick={() => onToggleDone(event)}
          // -m-2 p-2 grows the tap target to ~31px without shifting the layout; the visual box stays 15px.
          className="-m-2 mt-0 shrink-0 cursor-pointer rounded-md p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true" className={taskBoxClass}>
            {isDone ? "✓" : ""}
          </span>
        </button>
        {onOpenDetail ? (
          <button
            type="button"
            onClick={() => onOpenDetail(event)}
            aria-haspopup="dialog"
            className="min-w-0 flex-1 cursor-pointer rounded-[var(--radius)] text-start transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{content}</div>
        )}
      </div>
    );
  }

  // Non-interactive-toggle paths: the marker is a decorative <span> (kind by FORM). The card body is
  // identical whether inert or detail-interactive — only the wrapping element changes.
  const body = (
    <>
      <div className="flex items-baseline gap-2">
        {variant === "reminder" && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 self-center rounded-full bg-primary"
          />
        )}
        {variant === "task" && (
          <span aria-hidden="true" className={cn("mt-0.5", taskBoxClass)}>
            {isDone ? "✓" : ""}
          </span>
        )}
        {KIND_LABEL[variant] && <span className="sr-only">{KIND_LABEL[variant]}: </span>}
        {titleNode}
      </div>
      {meta}
    </>
  );

  // Interactive only when given onOpenDetail: a real <button> (free keyboard/Enter/Space + role),
  // following PersonChip's display→button precedent. Omitted ⇒ inert <div> (presentational contract).
  if (onOpenDetail) {
    return (
      <button
        {...props}
        type="button"
        onClick={() => onOpenDetail(event)}
        // It opens the detail drawer (a dialog) → announce that; min-h-[44px] keeps a bare title-only
        // card above the phone touch-target floor even though the row padding lives on the parent (F2).
        aria-haspopup="dialog"
        className={cn(
          "@container/card block min-h-[44px] w-full min-w-0 cursor-pointer rounded-[var(--radius)] text-start transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div {...props} className={cn("@container/card min-w-0", className)}>
      {body}
    </div>
  );
}
