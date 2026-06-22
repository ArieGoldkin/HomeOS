import { type InboundMessageDTO, inboundMessagesResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";
/**
 * The messages feed uses a DISTINCT token from the read token — the server never aliases them. Unlike
 * the write token, there is deliberately NO dev fallback to the read token: the raw inbound feed can
 * carry pre-allowlist / non-family text, so reading it is a separate privilege you must opt into by
 * setting VITE_HOMEOS_MESSAGES_TOKEN (empty ⇒ the server answers 401, which is the correct default).
 */
const messagesAuth = import.meta.env.VITE_HOMEOS_MESSAGES_TOKEN ?? "";

/**
 * Typed fetch of the raw inbound-message feed (#135). The server is Bearer-gated and wraps rows as
 * `{ messages }` (NOT a bare array), so we send the distinct messages token and parse the envelope with
 * `inboundMessagesResponseSchema` — any shape drift fails loudly here, never silently in the UI.
 */
export async function fetchMessages(signal?: AbortSignal): Promise<InboundMessageDTO[]> {
  const res = await fetch(`${API_BASE}/messages`, {
    headers: { Authorization: `Bearer ${messagesAuth}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /messages failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return inboundMessagesResponseSchema.parse(data).messages;
}
