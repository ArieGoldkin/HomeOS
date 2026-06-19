import { cn } from "@shared/lib";

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  /** The currently selected value. */
  value: string;
  /** Called with the new value when a segment is clicked. */
  onValueChange: (v: string) => void;
  /** The ordered list of selectable segments. */
  options: SegmentedOption[];
  /** Accessible label for the group (required when the visual context is insufficient). */
  "aria-label"?: string;
  /** Additional class names on the outer container. */
  className?: string;
}

/**
 * Pill-shaped N-of-one selector (radio group semantics). Used for kind
 * selection: event | reminder | task. The selected segment fills with ocean
 * primary; unselected segments show muted text on the secondary background.
 * Keyboard-accessible: each segment is a real `<button role="radio">`.
 */
export function SegmentedControl({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center bg-secondary rounded-full p-1 gap-1", className)}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a styled segmented control needs buttons; native <input type="radio"> can't render as filled pills.
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "px-4 min-h-9 rounded-full text-[14px] font-medium transition",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground hover:bg-background",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
