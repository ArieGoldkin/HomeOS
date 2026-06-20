import { cn } from "@shared/lib";
import type { KeyboardEvent } from "react";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string = string> {
  /** The currently selected value. */
  value: T;
  /** Called with the new value when a segment is activated (click or arrow keys). */
  onValueChange: (v: T) => void;
  /** The ordered list of selectable segments. */
  options: readonly SegmentedOption<T>[];
  /** Accessible label for the group (required when the visual context is insufficient). */
  "aria-label"?: string;
  /** Additional class names on the outer container. */
  className?: string;
}

const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

/**
 * Resolve the next index for a radio-group key press. RTL flips the horizontal arrows (per the WAI-ARIA
 * APG): in RTL ArrowLeft advances and ArrowRight retreats. Vertical arrows are unaffected by direction.
 */
function nextIndex(current: number, length: number, key: string, rtl: boolean): number {
  const forward = key === "ArrowDown" || (rtl ? key === "ArrowLeft" : key === "ArrowRight");
  const backward = key === "ArrowUp" || (rtl ? key === "ArrowRight" : key === "ArrowLeft");
  if (forward) return (current + 1) % length;
  if (backward) return (current - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return current;
}

/**
 * Pill-shaped N-of-one selector (WAI-ARIA radio group). Used for kind selection: event | reminder |
 * task. The selected segment fills with ocean primary; unselected segments show muted text on the
 * secondary background. Generic over the value union (`SegmentedControl<EventKind>`) so the option
 * values flow through to `onValueChange` — no cast at the call site.
 *
 * Keyboard model: a roving tabindex (only the selected radio is tabbable) plus arrow/Home/End keys
 * move selection, RTL-aware. Each segment is a real `<button role="radio">`.
 */
export function SegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.includes(e.key)) return;
    e.preventDefault();
    const current = options.findIndex((o) => o.value === value);
    // Read the resolved writing direction from the nearest ancestor carrying a dir attribute
    // (the app root is dir="rtl"); jsdom honors this attribute lookup deterministically.
    const rtl = e.currentTarget.closest("[dir]")?.getAttribute("dir") === "rtl";
    const idx = nextIndex(current < 0 ? 0 : current, options.length, e.key, rtl);
    const next = options[idx];
    if (!next) return;
    onValueChange(next.value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']");
    buttons[idx]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
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
            tabIndex={selected ? 0 : -1}
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
