import type { ParsedEvent } from "@homeos/shared";
import { Dialog } from "@shared/ui";
import { AddItemForm } from "./AddItemForm";
import { useAddEventController } from "./use-add-event";

export interface AddEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional notification fired with the validated event after it persists (analytics/tests). */
  onCreate?: (event: ParsedEvent) => void;
}

/**
 * The one AddEvent host (#184) — the shared AddItemForm inside the responsive {@link Dialog} (bottom
 * sheet on phones, centered modal ≥md). Replaces the old surface-split AddEventModal + AddEventSheet;
 * the persistence wiring (useAddEventController → POST /events) and the form are reused verbatim.
 */
export function AddEventDialog({ open, onOpenChange, onCreate }: AddEventDialogProps) {
  const { submitting, isError, submit, close } = useAddEventController(onOpenChange, onCreate);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="הוספה ללוח"
    >
      <AddItemForm submitting={submitting} onSubmit={submit} onCancel={close} />
      {isError && (
        <p role="alert" className="mt-3 text-[13px] text-coral">
          לא הצלחנו לשמור. נסו שוב.
        </p>
      )}
    </Dialog>
  );
}
