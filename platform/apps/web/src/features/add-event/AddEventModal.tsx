import type { ParsedEvent } from "@homeos/shared";
import { Modal } from "@shared/ui";
import { AddItemForm } from "./AddItemForm";
import { useAddEventController } from "./use-add-event";

export interface AddEventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional notification fired with the validated event after it persists (analytics/tests). */
  onCreate?: (event: ParsedEvent) => void;
}

/**
 * The web AddEvent surface: the shared AddItemForm inside a centered {@link Modal} (Radix Dialog).
 * Identical persistence behavior to the phone {@link AddEventSheet} — both share
 * {@link useAddEventController} (the create mutation + close/reset) and AddItemForm (the form) — and
 * differ only in the container chrome (centered modal vs bottom sheet).
 */
export function AddEventModal({ open, onOpenChange, onCreate }: AddEventModalProps) {
  const { submitting, isError, submit, close } = useAddEventController(onOpenChange, onCreate);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="הוספה ללוח"
    >
      <AddItemForm submitting={submitting} onSubmit={submit} onCancel={close} />
      {isError && (
        <p role="alert" className="mt-3 text-[13px] text-red-600">
          לא הצלחנו לשמור. נסו שוב.
        </p>
      )}
    </Modal>
  );
}
