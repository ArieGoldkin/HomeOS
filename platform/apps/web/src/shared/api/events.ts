import {
  type ParsedEvent,
  type SavedEvent,
  savedEventSchema,
  savedEventsResponseSchema,
} from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";
const READ_TOKEN = import.meta.env.VITE_HOMEOS_READ_TOKEN ?? "";
/**
 * Separate write token so read-only deployments can't mutate. For local dev it falls back to the
 * read token so one token works — but the server (PR #119) requires a DISTINCT write token and will
 * not accept the read token for writes, so set VITE_HOMEOS_WRITE_TOKEN to match the server's value.
 */
const WRITE_TOKEN =
  import.meta.env.VITE_HOMEOS_WRITE_TOKEN ?? import.meta.env.VITE_HOMEOS_READ_TOKEN ?? "";

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

/**
 * POST a newly-parsed event to the family board via the server `POST /events` write seam (PR #119).
 * The write token falls back to the read token for local dev, but the server requires a distinct
 * write token and won't accept the read token for writes.
 *
 * Throws `Error("POST /events failed (<status>)")` on any non-2xx response.
 * Parses the server's single-row JSON response with `savedEventSchema` so shape drift
 * fails loudly here, never silently in the UI.
 */
export async function createEvent(parsed: ParsedEvent): Promise<SavedEvent> {
  const res = await fetch(`${API_BASE}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WRITE_TOKEN}`,
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
