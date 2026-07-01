import type { ConsentStatus } from "@homeos/shared";
import { acceptConsent } from "@shared/api";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { consentQueryKey } from "./use-consent";

/**
 * #270 — record the user's acceptance of the current Terms/Privacy via `POST /consent`. On success it SEEDS
 * the `consentQueryKey` cache with the returned consented status, so the `ConsentGate` flips from the consent
 * screen to the app immediately. The POST response IS the authoritative status (the server just persisted
 * it), so we deliberately do NOT invalidate/refetch — that would be a redundant round-trip and, with
 * `staleTime: Infinity`, the seeded value stands. No arguments — consent is for the session's own user.
 */
export function useAcceptConsent(): UseMutationResult<ConsentStatus, Error, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acceptConsent(),
    onSuccess: (status) => {
      qc.setQueryData(consentQueryKey, status);
    },
  });
}
