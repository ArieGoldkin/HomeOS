import type { ParsedEvent, SavedEvent } from "@homeos/shared";
import { createEvent } from "@shared/api";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsQueryKey } from "./use-events";

/**
 * Mutation hook for adding a new event to the family board via `POST /events`.
 * On success it invalidates the `eventsQueryKey` cache so `useEvents` re-fetches
 * and the new row appears on the tablet without a manual refresh.
 *
 * The server route `POST /events` is live (PR #119); this hook wires the client seam to it.
 * Tests use the msw stub for the network.
 */
export function useCreateEvent(): UseMutationResult<SavedEvent, Error, ParsedEvent> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createEvent,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventsQueryKey });
    },
  });
}
