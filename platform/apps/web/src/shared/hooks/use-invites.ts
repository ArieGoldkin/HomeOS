import type { Invite } from "@homeos/shared";
import { fetchInvites } from "@shared/api";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";

export const invitesQueryKey = ["invites"] as const;

/**
 * #250 — the owner's pending invites from `GET /invites`. This query DOUBLES AS THE OWNER GATE: the server
 * 403s a non-owner, so a non-owner's query lands in `error` and the invite card hides (capability-based
 * gating — the web has no current-user role otherwise). `retry: false` so a 403 fails fast (no retry storm
 * on every non-owner page load); a short `staleTime` since the list changes on owner action. TanStack still
 * refetches on mount/refocus, so a freshly-minted/revoked invite shows after the mutation invalidates.
 */
export function useInvites(): UseQueryResult<Invite[], Error> {
  return useQuery({
    queryKey: invitesQueryKey,
    queryFn: () => fetchInvites(),
    retry: false,
    staleTime: 60_000,
  });
}
