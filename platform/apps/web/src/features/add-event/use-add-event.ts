import type { ParsedEvent } from "@homeos/shared";
import { useCreateEvent } from "@shared/hooks";

export interface AddEventController {
  /** True while the create is in flight — drives the Save button's double-submit guard. */
  submitting: boolean;
  /** True if the last create failed — drives the error notice. */
  isError: boolean;
  /** Validate-and-persist a submitted event; on success fires onCreate and closes the surface. */
  submit: (event: ParsedEvent) => void;
  /** Reset the mutation and close the surface (so a stale error never lingers on reopen). */
  close: () => void;
}

/**
 * Controller for the AddEvent host ({@link AddEventDialog}) — owns the create mutation (`POST /events`),
 * resets it on close, and closes on success. Kept separate from the form so the persistence wiring lives
 * in one place (the "no duplication" half of the shared-form contract).
 */
export function useAddEventController(
  onOpenChange: (open: boolean) => void,
  onCreate?: (event: ParsedEvent) => void,
): AddEventController {
  const createEvent = useCreateEvent();

  function close() {
    createEvent.reset();
    onOpenChange(false);
  }

  function submit(event: ParsedEvent) {
    createEvent.mutate(event, {
      onSuccess: () => {
        onCreate?.(event);
        close();
      },
    });
  }

  return { submitting: createEvent.isPending, isError: createEvent.isError, submit, close };
}
