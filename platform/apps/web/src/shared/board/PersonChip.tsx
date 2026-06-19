import { assigneeColor, cn } from "@shared/lib";
import { cva, type VariantProps } from "class-variance-authority";
import type { CSSProperties, HTMLAttributes } from "react";

const chip = cva(
  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-semibold text-[13px]",
  {
    variants: {
      selected: {
        // selected: border + wash come from the person's RUNTIME color (inline style below)
        true: "text-foreground",
        false: "border-input bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface PersonChipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof chip> {
  /** The assignee — drives a STABLE color via assigneeColor() (a runtime concern, never a --who-* token). */
  name: string;
  /** Pick the night-optimized color set (the always-on tablet runs night by default). */
  night?: boolean;
}

/**
 * The one person-chip for the whole app (issue #93: ONE component, not a display + a selectable twin).
 * Resting it's a quiet outlined pill with a color dot + name; `selected` lifts it to the person's own
 * color (border + wash). Color is looked up at runtime from the free-form assignee string — the
 * prototype's --who-* sample vars are deliberately NOT used. Logical properties only for RTL.
 */
export function PersonChip({
  name,
  selected = false,
  night = false,
  className,
  style,
  ...props
}: PersonChipProps) {
  const color = assigneeColor(name);
  const dot = night ? color.night : color.light;
  const wash = night ? color.nightWash : color.lightWash;
  const selectedStyle: CSSProperties = selected ? { borderColor: dot, background: wash } : {};

  return (
    <span
      data-selected={selected || undefined}
      className={cn(chip({ selected }), className)}
      style={{ ...selectedStyle, ...style }}
      {...props}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      {name}
    </span>
  );
}
