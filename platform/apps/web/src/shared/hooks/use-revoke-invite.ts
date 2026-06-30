import { revokeInvite } from "@shared/api";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { invitesQueryKey } from "./use-invites";

/**
 * #250 — owner-revoke a pending invite via `DELETE /invites/:id` (by invite_id). On success it invalidates
 * `invitesQueryKey` so the revoked invite drops out of the owner's list. The mutation variable is the
 * invite_id string.
 */
export function useRevokeInvite(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeInvite,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invitesQueryKey });
    },
  });
}
