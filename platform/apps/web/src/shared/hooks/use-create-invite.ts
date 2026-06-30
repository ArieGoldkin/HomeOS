import type { Invite, InviteRequest } from "@homeos/shared";
import { createInvite } from "@shared/api";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { invitesQueryKey } from "./use-invites";

/**
 * #250 — mint an invite via `POST /invites`. On success it invalidates `invitesQueryKey` so `useInvites`
 * refetches and the new pending invite appears in the owner's list without a manual refresh (mirrors
 * {@link useCreateEvent}). Errors (400 bad email / 403 not owner) surface via `isError` for the dialog.
 */
export function useCreateInvite(): UseMutationResult<Invite, Error, InviteRequest> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createInvite,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invitesQueryKey });
    },
  });
}
