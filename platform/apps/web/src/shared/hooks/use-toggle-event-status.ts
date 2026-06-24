import type { EventStatus, SavedEvent } from "@homeos/shared";
import { setEventStatus } from "@shared/api";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsQueryKey } from "./use-events";

/**
 * #19 — mutation hook for the task done-toggle via `PATCH /events/:id`. On success it invalidates the
 * `eventsQueryKey` cache so `useEvents` re-fetches and the board reflects the new open/done state. Mirrors
 * `useCreateEvent` (invalidate-on-success — the 30s board poll + immediate invalidate keep it fresh;
 * optimistic UI is a deferrable enhancement).
 */
export function useToggleEventStatus(): UseMutationResult<
  SavedEvent,
  Error,
  { id: number; status: EventStatus }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => setEventStatus(id, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventsQueryKey });
    },
  });
}
