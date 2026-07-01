import type { BoundPhone } from "@homeos/shared";
import { fetchPhones } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const phonesQueryKey = ["phones"] as const;

/**
 * #262 — the family's bound WhatsApp senders from `GET /phones`. This query DOUBLES AS THE OWNER GATE: the
 * server 403s a non-owner, so a non-owner's query lands in `error` and the revoke card hides (capability-based
 * gating — the web has no current-user role otherwise, exactly like `useInvites`). `retry: false` so a 403
 * fails fast (no retry storm on every non-owner page load); a short `staleTime` since the list changes on
 * owner action. TanStack still refetches on mount/refocus, so an unbound number drops after the mutation
 * invalidates.
 */
export function usePhones(): UseQueryResult<BoundPhone[], Error> {
  return useQuery({
    queryKey: phonesQueryKey,
    queryFn: () => fetchPhones(),
    retry: false,
    staleTime: 60_000,
  });
}
