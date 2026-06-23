import { cn } from "@shared/lib";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

/**
 * A small tinted status pill (#174) — design system §04. Tones map to the living-accent
 * tokens with a translucent wash, so they shift correctly between light and dark (text uses
 * the same accent token, which lightens in dark). Used for People status, agenda pills, and
 * the Connections / messages outcome states.
 */
const pill = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold text-[12px]",
  {
    variants: {
      tone: {
        active: "bg-primary/15 text-primary",
        pending: "bg-blue/15 text-blue",
        overdue: "bg-coral/15 text-coral",
        archived: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { tone: "active" },
  },
);

export interface StatusPillProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pill> {}

export function StatusPill({ tone, className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(pill({ tone }), className)} {...props}>
      {children}
    </span>
  );
}
