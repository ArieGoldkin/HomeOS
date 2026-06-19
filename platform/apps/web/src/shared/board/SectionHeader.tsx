import { cn } from "@shared/lib";
import type { HTMLAttributes, ReactNode } from "react";

export interface SectionHeaderProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

/**
 * A section eyebrow ("אירועים היום", "מחר") above a band of board content. Sentence-case with a
 * touch of tracking — deliberately NEVER uppercased (DESIGN.md §12 ban #3: all-caps Hebrew labels
 * are the #1 AI-slop tell). Muted-foreground keeps it a quiet label, not a heading shout.
 */
export function SectionHeader({ children, className, ...props }: SectionHeaderProps) {
  return (
    <p
      className={cn("font-semibold text-[11px] tracking-[0.04em] text-muted-foreground", className)}
      {...props}
    >
      {children}
    </p>
  );
}
