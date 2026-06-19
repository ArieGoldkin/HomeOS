import type { SavedEvent } from "@homeos/shared";
import { fetchEvents } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const eventsQueryKey = ["events"] as const;

/**
 * The board's events from `GET /events`. For the always-on kitchen tablet, `refetchInterval` (30s)
 * means a forwarded WhatsApp event appears on its own; `staleTime` (10s) dedupes rapid re-renders.
 */
export function useEvents(): UseQueryResult<SavedEvent[], Error> {
  return useQuery({
    queryKey: eventsQueryKey,
    // No AbortSignal: TanStack's signal trips the msw+undici test env (aborts pre-send); /events is fast + idempotent.
    queryFn: () => fetchEvents(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
