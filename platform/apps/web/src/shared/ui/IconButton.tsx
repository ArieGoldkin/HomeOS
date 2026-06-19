import { cn } from "@shared/lib";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

/**
 * 44×44px square icon button. `aria-label` is REQUIRED — every icon-only
 * control must carry a Hebrew description so screen readers can announce it.
 * Rounded-full shape keeps it distinct from the rectangular Button atom.
 */
const iconButton = cva(
  "size-11 rounded-full grid place-items-center transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        ghost: "bg-transparent text-foreground hover:bg-secondary",
      },
    },
    defaultVariants: { variant: "ghost" },
  },
);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButton> {
  /** Hebrew label required for icon-only buttons (a11y). */
  "aria-label": string;
}

export function IconButton({
  variant,
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button type={type} className={cn(iconButton({ variant }), className)} {...props}>
      {children}
    </button>
  );
}
