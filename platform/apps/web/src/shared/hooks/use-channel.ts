import type { ChannelResponse } from "@homeos/shared";
import { fetchChannel } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const channelQueryKey = ["channel"] as const;

/**
 * #231 (Slice B) — the WhatsApp bot number from `GET /channel` (the connections page reads it instead of the
 * hardcoded BOT_NUMBER). Mirrors {@link useFamily}: a long `staleTime` (5m) because the bot number is a
 * near-static config value, and no `refetchInterval` — TanStack still refetches on mount/refocus.
 */
export function useChannel(): UseQueryResult<ChannelResponse, Error> {
  return useQuery({
    queryKey: channelQueryKey,
    queryFn: () => fetchChannel(),
    staleTime: 300_000,
  });
}
