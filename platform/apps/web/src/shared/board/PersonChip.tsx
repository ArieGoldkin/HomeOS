import { assigneeColor, cn } from "@shared/lib";
import { useThemeMode } from "@shared/theme";
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
  extends Omit<HTMLAttributes<HTMLElement>, "color">,
    VariantProps<typeof chip> {
  /** The assignee — drives a STABLE color via assigneeColor() (a runtime concern, never a --who-* token). */
  name: string;
  /** Selected/pressed state. Narrowed to boolean (CVA would allow null) so aria-pressed is valid. */
  selected?: boolean;
}

/**
 * The one person-chip for the whole app (issue #93: ONE component, not a display + a selectable twin).
 * Resting it's a quiet outlined pill with a color dot + name; `selected` lifts it to the person's own
 * color (border + wash). Color is looked up at runtime from the free-form assignee string — the
 * prototype's --who-* sample vars are deliberately NOT used. Logical properties only for RTL.
 *
 * Polymorphic by interactivity: a pure display chip (no `onClick`) renders a non-interactive `<span>`
 * (state exposed only via `data-selected`, so it stays out of the tab order). Once wired as a
 * selectable toggle (`onClick`), it renders a real `<button>` with `aria-pressed` + native keyboard
 * — so the selected state is announced to assistive tech, not just shown (review #115 finding 1).
 */
export function PersonChip({
  name,
  selected = false,
  className,
  style,
  onClick,
  ...props
}: PersonChipProps) {
  const color = assigneeColor(name);
  const mode = useThemeMode();
  const dot = mode === "dark" ? color.night : color.light;
  const wash = mode === "dark" ? color.nightWash : color.lightWash;
  const selectedStyle: CSSProperties = selected ? { borderColor: dot, background: wash } : {};
  const mergedStyle = { ...selectedStyle, ...style };
  const content = (
    <>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      {name}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cn(chip({ selected }), "cursor-pointer", className)}
        style={mergedStyle}
        {...props}
      >
        {content}
      </button>
    );
  }

  return (
    <span
      data-selected={selected || undefined}
      className={cn(chip({ selected }), className)}
      style={mergedStyle}
      {...props}
    >
      {content}
    </span>
  );
}
