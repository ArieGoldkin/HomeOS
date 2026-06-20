import { cn } from "@shared/lib";
import type { HTMLAttributes } from "react";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  /** True = person is online/connected. */
  online?: boolean;
}

/**
 * A 10px presence dot: green when online, muted-foreground wash when offline.
 * Rendered with an aria-label in Hebrew ("מחובר" / "לא מחובר") so screen-readers
 * can announce presence even when the dot is used standalone. If you place it
 * beside a visible name you may suppress the label with `aria-hidden="true"`.
 */
export function StatusDot({ online = false, className, ...props }: StatusDotProps) {
  return (
    <span
      role="img"
      aria-label={online ? "מחובר" : "לא מחובר"}
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        online ? "bg-green-500" : "bg-muted-foreground/40",
        className,
      )}
      {...props}
    />
  );
}
