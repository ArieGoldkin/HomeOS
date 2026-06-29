import { type ChannelResponse, channelResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * #231 (Slice B) — typed fetch of the WhatsApp channel config from `GET /channel`. Like {@link fetchFamily}
 * the server is session-gated (#225): we send the Supabase session COOKIE (`credentials: "include"`), no
 * bearer. `botPhone` is `null` when the server has no `BOT_PHONE_NUMBER` set — the UI renders a fallback,
 * never a fake number. Parsed with `channelResponseSchema` so shape drift fails loudly here, not in the UI.
 */
export async function fetchChannel(signal?: AbortSignal): Promise<ChannelResponse> {
  const res = await fetch(`${API_BASE}/channel`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /channel failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return channelResponseSchema.parse(data);
}
