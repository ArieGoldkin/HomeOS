import {
  type EventStatus,
  type ParsedEvent,
  type SavedEvent,
  savedEventSchema,
  savedEventsResponseSchema,
} from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * Typed fetch of the family board. The server is session-gated (#225): instead of a build-embedded
 * bearer token we send the Supabase session COOKIE — `credentials: "include"` so the same-origin server
 * reads it. The endpoint wraps rows as `{ events }` (NOT a bare array), so we parse the envelope with
 * `savedEventsResponseSchema` — any shape drift fails loudly here, never silently in the UI.
 */
export async function fetchEvents(signal?: AbortSignal): Promise<SavedEvent[]> {
  const res = await fetch(`${API_BASE}/events`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /events failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return savedEventsResponseSchema.parse(data).events;
}

/**
 * POST a newly-parsed event to the family board via the server `POST /events` write seam. Authorized by
 * the same Supabase session cookie as the rest of the board (`credentials: "include"`).
 *
 * Throws `Error("POST /events failed (<status>)")` on any non-2xx response.
 * Parses the server's single-row JSON response with `savedEventSchema` so shape drift
 * fails loudly here, never silently in the UI.
 */
export async function createEvent(parsed: ParsedEvent): Promise<SavedEvent> {
  const res = await fetch(`${API_BASE}/events`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed),
  });
  if (!res.ok) {
    throw new Error(`POST /events failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return savedEventSchema.parse(data);
}

/**
 * #19 — toggle a board task's open/done state via the server `PATCH /events/:id` write seam. Authorized by
 * the Supabase session cookie (`credentials: "include"`). Returns the updated single SavedEvent, parsed with
 * `savedEventSchema` so shape drift fails loudly here. Throws `Error("PATCH /events/<id> failed (<status>)")`
 * on any non-2xx (e.g. 404 when the row isn't a board row).
 */
export async function setEventStatus(id: number, status: EventStatus): Promise<SavedEvent> {
  const res = await fetch(`${API_BASE}/events/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`PATCH /events/${id} failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return savedEventSchema.parse(data);
}
