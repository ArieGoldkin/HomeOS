import type { ParsedEvent } from "@homeos/shared";
import { Sheet } from "@shared/ui";
import { AddItemForm } from "./AddItemForm";

export interface AddEventSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional hook for the validated event. For #96 the form is validation-only: on a valid submit we
   * just close the sheet. When the server `POST /events` lands, wire this to `useCreateEvent().mutate`.
   */
  onCreate?: (event: ParsedEvent) => void;
}

/**
 * The phone AddEvent surface: the shared AddItemForm inside a bottom Sheet (Radix → focus-trap + ESC).
 * A valid submit closes the sheet (and calls `onCreate` if provided); cancel closes it too.
 */
export function AddEventSheet({ open, onOpenChange, onCreate }: AddEventSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="הוספה ללוח">
      <AddItemForm
        onSubmit={(event) => {
          onCreate?.(event);
          onOpenChange(false);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
