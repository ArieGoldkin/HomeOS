import { type SavedEvent, savedEventsResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";
const READ_TOKEN = import.meta.env.VITE_HOMEOS_READ_TOKEN ?? "";

/**
 * Typed fetch of the family board. The server is Bearer-gated and wraps rows as `{ events }`
 * (NOT a bare array), so we send the family read-token and parse the envelope with
 * `savedEventsResponseSchema` — any shape drift fails loudly here, never silently in the UI.
 */
export async function fetchEvents(signal?: AbortSignal): Promise<SavedEvent[]> {
  const res = await fetch(`${API_BASE}/events`, {
    headers: { Authorization: `Bearer ${READ_TOKEN}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /events failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return savedEventsResponseSchema.parse(data).events;
}
