import type { ConsentStatus } from "@homeos/shared";
import { fetchConsent } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const consentQueryKey = ["consent"] as const;

/**
 * #270 — the session user's Terms/Privacy consent status from `GET /consent`. The `ConsentGate` reads this
 * to decide whether to show the consent screen. Retries are INHERITED (the prod client retries transient
 * failures, so a blip during a deploy self-heals rather than stranding the gate on the error screen); the
 * accept mutation SEEDS this query's cache (`setQueryData`) so the gate flips without a refetch. A finite
 * `staleTime` (not Infinity) + refetch-on-focus means a `CURRENT_TERMS_VERSION` bump re-prompts an
 * already-open session the next time the user returns to the tab, rather than never.
 */
export function useConsent(): UseQueryResult<ConsentStatus, Error> {
  return useQuery({
    queryKey: consentQueryKey,
    queryFn: () => fetchConsent(),
    staleTime: 60_000,
  });
}
