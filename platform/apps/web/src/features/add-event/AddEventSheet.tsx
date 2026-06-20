import type { ParsedEvent } from "@homeos/shared";
import { useCreateEvent } from "@shared/hooks";
import { Sheet } from "@shared/ui";
import { AddItemForm } from "./AddItemForm";

export interface AddEventSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional notification fired with the validated event after it persists (analytics/tests). */
  onCreate?: (event: ParsedEvent) => void;
}

/**
 * The phone AddEvent surface: the shared AddItemForm inside a bottom Sheet (Radix → focus-trap + ESC).
 * On a valid submit it persists via `useCreateEvent` (POST /events); the Save button is disabled while
 * the create is in flight (double-submit guard — `web:<uuid>` keys don't dedupe). On success it fires
 * `onCreate` and closes; on failure it stays open with an error notice so the user can retry. Cancel,
 * ESC, and overlay-close all reset the mutation so a stale error never lingers on reopen.
 */
export function AddEventSheet({ open, onOpenChange, onCreate }: AddEventSheetProps) {
  const createEvent = useCreateEvent();

  function close() {
    createEvent.reset();
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="הוספה ללוח"
    >
      <AddItemForm
        submitting={createEvent.isPending}
        onSubmit={(event) =>
          createEvent.mutate(event, {
            onSuccess: () => {
              onCreate?.(event);
              close();
            },
          })
        }
        onCancel={close}
      />
      {createEvent.isError && (
        <p role="alert" className="mt-3 text-[13px] text-red-600">
          לא הצלחנו לשמור. נסו שוב.
        </p>
      )}
    </Sheet>
  );
}
