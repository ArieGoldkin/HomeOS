import { cn } from "@shared/lib";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

/**
 * The design system's three card surfaces (#174). `surface` = the white content card,
 * `muted` = the beige grouping card, `glass` = the dark translucent card that floats over
 * the night gradient (it paints `--card-glass` and applies `backdrop-filter: var(--card-blur)`,
 * both no-ops in light, so the SAME variant reads correct in both themes). Token-driven, so a
 * globals.css swap reskins every card. Padding is the consumer's call (compose `p-*`).
 */
const card = cva("rounded-[var(--radius-card)] border border-[var(--card-border)]", {
  variants: {
    variant: {
      surface: "bg-card text-card-foreground shadow-card",
      muted: "bg-card-muted text-card-foreground",
      glass:
        "text-card-foreground shadow-card [background:var(--card-glass)] [backdrop-filter:var(--card-blur)]",
    },
  },
  defaultVariants: { variant: "surface" },
});

export interface CardProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof card> {}

export function Card({ variant, className, children, ...props }: CardProps) {
  return (
    <div className={cn(card({ variant }), className)} {...props}>
      {children}
    </div>
  );
}
