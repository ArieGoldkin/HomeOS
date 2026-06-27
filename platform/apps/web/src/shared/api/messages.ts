import { type InboundMessageDTO, inboundMessagesResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * Typed fetch of the raw inbound-message feed (#135). Session-gated like the rest of the app (#225): we
 * send the Supabase session COOKIE (`credentials: "include"`) and the same-origin server gates access. The
 * endpoint wraps rows as `{ messages }` (NOT a bare array), so we parse the envelope with
 * `inboundMessagesResponseSchema` — any shape drift fails loudly here, never silently in the UI.
 */
export async function fetchMessages(signal?: AbortSignal): Promise<InboundMessageDTO[]> {
  const res = await fetch(`${API_BASE}/messages`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /messages failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return inboundMessagesResponseSchema.parse(data).messages;
}
