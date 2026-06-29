import type { FamilyRosterResponse } from "@homeos/shared";
import { fetchFamily } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const familyQueryKey = ["family"] as const;

/**
 * #235 — the family roster from `GET /family` (the read seam the board un-mocks KNOWN_ROSTER/HOUSEHOLD
 * onto). Mirrors {@link useEvents}: a longer `staleTime` (5m) than the events feed because the roster
 * changes rarely (a member is added/renamed, not every forward), and no `refetchInterval` for the same
 * reason — TanStack still refetches on mount/refocus.
 */
export function useFamily(): UseQueryResult<FamilyRosterResponse, Error> {
  return useQuery({
    queryKey: familyQueryKey,
    queryFn: () => fetchFamily(),
    staleTime: 300_000,
  });
}
