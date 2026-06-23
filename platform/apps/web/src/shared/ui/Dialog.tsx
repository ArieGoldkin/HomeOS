import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@shared/lib";
import type { ReactNode } from "react";

export interface DialogProps {
  /** Controls whether the dialog is open (controlled component). */
  open: boolean;
  /** Called by Radix when the open state should change (ESC, overlay click, close button). */
  onOpenChange: (open: boolean) => void;
  /** Displayed as the dialog heading and provides the accessible dialog name. */
  title: string;
  /** Dialog body content — scrollable if taller than max-h-[85vh]. */
  children: ReactNode;
  /** Extra Tailwind classes merged onto the content panel. */
  className?: string;
}

/**
 * The one responsive dialog host (#184) — a single `@radix-ui/react-dialog` that renders as a bottom
 * SHEET below `md` (slides up, top-rounded, viewport-anchored) and a centered MODAL at `md`+ (fades in,
 * fully rounded, float-elevated). Replaces the old surface-split Modal + Sheet: one Radix Root means one
 * focus trap / scroll-lock / overlay (rendering two and CSS-toggling would duplicate all three). The
 * sheet↔modal swap is pure CSS breakpoint classes + the `.dialog-pop` animation (reduced-motion aware),
 * so there is no `surface` prop. RTL is inherited from the app root via logical properties.
 */
export function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ animation: "fadeIn var(--dur) ease" }}
        />

        {/* Labelled by Title; no separate Description by design → opt out of Radix's dev warning. */}
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            // phone: bottom sheet
            "dialog-pop fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[var(--radius-lg)]",
            // desktop (md+): centered modal
            "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100%-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[var(--radius-lg)]",
            "bg-card shadow-float",
            "max-h-[85vh] overflow-y-auto p-5",
            "focus:outline-none",
            className,
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <RadixDialog.Title className="font-display font-bold text-[18px] text-[color:var(--ink)]">
              {title}
            </RadixDialog.Title>

            <RadixDialog.Close
              aria-label="סגירה"
              className={cn(
                "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:text-foreground",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </RadixDialog.Close>
          </div>

          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
