import { cn } from "@shared/lib";
import type { HTMLAttributes } from "react";

export interface SectionLabelProps extends HTMLAttributes<HTMLSpanElement> {}

/**
 * The Modern section-label — a semibold ink label sitting above a Card group or list section
 * (Today / People / Connections / Settings). Renders a `<span>` (carries no heading level); pass
 * `className` for per-site layout (e.g. `px-1` inside a padded list). Extracted from the inline
 * copies of this identical markup across the screens (#183 review nit).
 */
export function SectionLabel({ className, children, ...props }: SectionLabelProps) {
  return (
    <span
      className={cn("font-semibold text-[14.5px] text-[color:var(--ink)]", className)}
      {...props}
    >
      {children}
    </span>
  );
}
