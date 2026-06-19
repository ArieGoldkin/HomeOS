import { cn } from "@shared/lib";
import type { HTMLAttributes } from "react";

export type RuleBarProps = HTMLAttributes<HTMLSpanElement>;

/**
 * The signature hairline rule that draws in right→left (under RTL) when a new event lands — the
 * board's "trust cue" (DESIGN.md §10). A 2px ocean rule; the `draw-rule` class carries the keyframe,
 * timing, and `transform-origin: var(--draw-origin)` (set once on <html> in App.tsx), so the same
 * atom is RTL-aware with no per-instance physical positioning. Decorative → aria-hidden.
 */
export function RuleBar({ className, ...props }: RuleBarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("draw-rule block h-0.5 bg-primary", className)}
      {...props}
    />
  );
}
