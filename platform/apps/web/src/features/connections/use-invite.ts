import type { InviteRequest } from "@homeos/shared";
import { useCreateInvite } from "@shared/hooks";

export interface InviteController {
  /** True while the mint is in flight — drives the submit button's double-submit guard. */
  submitting: boolean;
  /** True if the last mint failed (400 bad email / 403 not owner) — drives the error notice. */
  isError: boolean;
  /** Mint an invite; on success fires onCreated and closes the dialog. */
  submit: (req: InviteRequest) => void;
  /** Reset the mutation and close the dialog (so a stale error never lingers on reopen). */
  close: () => void;
}

/**
 * #250 — controller for {@link InviteMemberDialog}: owns the create mutation (`POST /invites`), resets it on
 * close, and closes on success. Mirrors `useAddEventController` — the persistence wiring lives in one place,
 * separate from the form. The list refresh is automatic (useCreateInvite invalidates the invites query).
 */
export function useInviteController(
  onOpenChange: (open: boolean) => void,
  onCreated?: () => void,
): InviteController {
  const createInvite = useCreateInvite();

  function close() {
    createInvite.reset();
    onOpenChange(false);
  }

  function submit(req: InviteRequest) {
    createInvite.mutate(req, {
      onSuccess: () => {
        onCreated?.();
        close();
      },
    });
  }

  return { submitting: createInvite.isPending, isError: createInvite.isError, submit, close };
}
