import { cn } from "@shared/lib";
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

// "Ink-not-dry" loading placeholder (DESIGN.md §10): a calm muted block — deliberately
// NOT a shimmer-sweep. Tone alone signals "settling", so it stays static and grain-friendly.
const skeleton = cva("bg-secondary", {
  variants: {
    variant: {
      block: "rounded-md",
      line: "h-3 rounded-sm",
      circle: "rounded-full",
    },
  },
  defaultVariants: { variant: "block" },
});

export interface SkeletonProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof skeleton> {}

export function Skeleton({ variant, className, ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={cn(skeleton({ variant }), className)} {...props} />;
}
