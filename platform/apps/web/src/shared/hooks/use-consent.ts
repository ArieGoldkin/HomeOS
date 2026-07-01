import type { ConsentStatus } from "@homeos/shared";
import { fetchConsent } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const consentQueryKey = ["consent"] as const;

/**
 * #270 — the session user's Terms/Privacy consent status from `GET /consent`. The `ConsentGate` reads this
 * to decide whether to show the consent screen. `staleTime: Infinity` — consent doesn't change without a
 * user action (the accept mutation invalidates it), so it never refetches on its own; `retry: false` so a
 * transient failure resolves fast into the gate's fail-open branch rather than a retry storm.
 */
export function useConsent(): UseQueryResult<ConsentStatus, Error> {
  return useQuery({
    queryKey: consentQueryKey,
    queryFn: () => fetchConsent(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
