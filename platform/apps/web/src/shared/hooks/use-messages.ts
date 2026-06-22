import type { InboundMessageDTO } from "@homeos/shared";
import { fetchMessages } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const messagesQueryKey = ["messages"] as const;

/**
 * The raw inbound-message feed from `GET /messages` (#135). Same 30s `refetchInterval` / 10s `staleTime`
 * as `useEvents` so a newly-forwarded message surfaces on its own (Realtime replaces the poll in Phase B).
 */
export function useMessages(): UseQueryResult<InboundMessageDTO[], Error> {
  return useQuery({
    queryKey: messagesQueryKey,
    // No AbortSignal: TanStack's signal trips the msw+undici test env; /messages is fast + idempotent.
    queryFn: () => fetchMessages(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
