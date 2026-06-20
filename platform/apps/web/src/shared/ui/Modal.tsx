import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@shared/lib";
import type { ReactNode } from "react";

export interface ModalProps {
  /** Controls whether the modal is open (controlled component). */
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
 * Controlled centered modal dialog for the HomeOS web surface — the desktop counterpart to {@link Sheet}
 * (the phone bottom-sheet). Same `@radix-ui/react-dialog` focus-trap / ESC / aria-modal semantics; the
 * only difference is placement (centered + fade) vs the phone's slide-up sheet. RTL is inherited from the
 * app root (`dir="rtl"`); logical properties adapt with no per-component overrides.
 */
export function Modal({ open, onOpenChange, title, children, className }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-black/40"
          style={{ animation: "fadeIn var(--dur) ease" }}
        />

        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100%-2rem)] max-w-md",
            "bg-card",
            "rounded-[calc(var(--radius)*2)]",
            "p-5",
            "max-h-[85vh] overflow-y-auto",
            "focus:outline-none",
            className,
          )}
          style={{ animation: "fadeIn var(--dur) ease" }}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="font-display font-bold text-[18px] text-foreground">
              {title}
            </Dialog.Title>

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
