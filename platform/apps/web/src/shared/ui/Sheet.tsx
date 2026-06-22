import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@shared/lib";
import type { ReactNode } from "react";

export interface SheetProps {
  /** Controls whether the sheet is open (controlled component). */
  open: boolean;
  /** Called by Radix when the open state should change (ESC, overlay click, etc.). */
  onOpenChange: (open: boolean) => void;
  /** Displayed as the sheet heading and provides the accessible dialog name. */
  title: string;
  /** Sheet body content — scrollable if taller than max-h-[85vh]. */
  children: ReactNode;
  /** Extra Tailwind classes merged onto the content panel. */
  className?: string;
}

/**
 * Controlled bottom-sheet for the HomeOS phone surface.
 *
 * Wraps `@radix-ui/react-dialog` so the focus trap, ESC handling, and
 * aria-modal semantics come for free.  Animations reuse the `sheetUp` and
 * `fadeIn` keyframes declared in globals.css (via the `--dur` custom property)
 * so the motion budget stays in one place.
 *
 * RTL: the app root carries `dir="rtl"` globally; logical CSS properties
 * (inset-x-0, p-5, etc.) adapt automatically — no per-component overrides needed.
 */
export function Sheet({ open, onOpenChange, title, children, className }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Scrim — fades in behind the sheet */}
        <Dialog.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ animation: "fadeIn var(--dur) ease" }}
        />

        {/* Sheet panel — slides up from the bottom of the viewport. The dialog is labelled by its Title;
            it intentionally has no separate Description, so opt out of Radix's dev warning explicitly. */}
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 mx-auto max-w-md",
            "bg-card",
            "rounded-t-[calc(var(--radius)*2)]",
            "p-5",
            "max-h-[85vh] overflow-y-auto",
            "focus:outline-none",
            className,
          )}
          style={{ animation: "sheetUp var(--dur) cubic-bezier(0.22,0.61,0.36,1)" }}
        >
          {/* Header row: accessible title + close button */}
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="font-display font-bold text-[18px] text-foreground">
              {title}
            </Dialog.Title>

            {/* Close button — min 44px touch target; aria-label is Hebrew "סגירה" */}
            <Dialog.Close
              aria-label="סגירה"
              className={cn(
                "flex items-center justify-center",
                "min-w-[44px] min-h-[44px]",
                "rounded-md",
                "text-muted-foreground hover:text-foreground",
                "transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {/* × glyph — intentional multiplication sign, visually balanced */}
              <span aria-hidden="true" className="text-xl leading-none">
                ×
              </span>
            </Dialog.Close>
          </div>

          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
