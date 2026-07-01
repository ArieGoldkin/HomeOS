import { type BoundPhone, phonesResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * #262 — the family's bound WhatsApp senders from `GET /phones`. Session-gated (#225) like the rest of the
 * board: the Supabase session COOKIE rides the request (`credentials: "include"`), no bearer. The server is
 * ALSO owner-gated — a non-owner gets 403 — which is what the web uses to gate the revoke UI: this throws on
 * the 403 so the `usePhones` query lands in `error` and the card stays hidden (capability-based gating,
 * exactly like `fetchInvites`). The payload is wrapped `{ phones }`, parsed with `phonesResponseSchema` so
 * shape drift fails loudly here.
 */
export async function fetchPhones(signal?: AbortSignal): Promise<BoundPhone[]> {
  const res = await fetch(`${API_BASE}/phones`, { credentials: "include", signal });
  if (!res.ok) {
    throw new Error(`GET /phones failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return phonesResponseSchema.parse(data).phones;
}

/**
 * #262 — owner-revoke a WhatsApp sender via `DELETE /phones/:phone` (family-scoped server-side → a foreign /
 * unknown number is 404). `fromPhone` is the digit-normalized value the list serves. Authorized by the
 * session cookie. Resolves on 204; throws on any non-2xx so the mutation surfaces it.
 */
export async function unbindPhone(fromPhone: string): Promise<void> {
  const res = await fetch(`${API_BASE}/phones/${encodeURIComponent(fromPhone)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`DELETE /phones/${fromPhone} failed (${res.status})`);
  }
}
