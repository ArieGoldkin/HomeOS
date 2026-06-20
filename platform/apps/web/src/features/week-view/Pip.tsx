import type { HTMLAttributes } from "react";

export interface PipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Background color for the pip dot. Defaults to `var(--primary)`. */
  color?: string;
}

/**
 * A 7px decorative summary dot, one per event on the week row.
 * Color is supplied at runtime via `assigneeColor(name).light`.
 */
export function Pip({ color, style, ...props }: PipProps) {
  return (
    <span
      aria-hidden="true"
      className="size-[7px] rounded-full shrink-0"
      style={{ background: color ?? "var(--primary)", ...style }}
      {...props}
    />
  );
}
