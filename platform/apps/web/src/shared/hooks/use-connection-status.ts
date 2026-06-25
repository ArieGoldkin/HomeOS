import type { ConnectionStatus } from "@homeos/shared";
import { fetchConnectionStatus } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

/**
 * The Google connection-status query key — also the invalidation target after a connect/disconnect
 * (`queryClient.invalidateQueries({ queryKey: googleStatusQueryKey })`), so a fresh status reflects the
 * mutation without a manual refetch.
 */
export const googleStatusQueryKey = ["google", "status"] as const;

/**
 * #111 — the Google connection status from `GET /oauth/google/status`. A `staleTime` of 30s dedupes the
 * Connect screen's rapid re-renders, while `refetchOnWindowFocus` re-checks when the user returns from
 * Google's consent tab (the common just-connected case). A 503 throws `GoogleNotConfiguredError`, which
 * surfaces here as `isError` + that error instance so the card can show the non-actionable "dark" state.
 */
export function useConnectionStatus(): UseQueryResult<ConnectionStatus, Error> {
  return useQuery({
    queryKey: googleStatusQueryKey,
    // No AbortSignal: TanStack's signal trips the msw+undici test env; the status read is fast + idempotent.
    queryFn: () => fetchConnectionStatus(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
