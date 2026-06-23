import { cn } from "@shared/lib";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

/**
 * The HomeOS action button. Variants cover the design system's button taxonomy:
 * green-filled CTA (`primary`), `ink` (dark/paper — the neutral primary action), quiet
 * `ghost`, and a `dashed` "add" affordance. Uses `type="button"` by default to avoid
 * accidental form submission when nested inside a `<form>`.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-[var(--radius)] font-medium text-[15px] transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        ink: "bg-foreground text-background hover:opacity-90",
        ghost: "bg-transparent text-foreground hover:bg-secondary",
        dashed:
          "border border-dashed border-input text-muted-foreground bg-transparent hover:bg-secondary",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ variant, className, type = "button", children, ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(button({ variant }), className)} {...props}>
      {children}
    </button>
  );
}
