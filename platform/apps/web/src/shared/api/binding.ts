import { bindingResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * #228 — mint a fresh single-use `HOME-XXXXX` binding code via `POST /binding` (session-gated, writer-only
 * server-side; the code is scoped to the session's family). Authorized by the same session cookie
 * (`credentials: "include"`), no bearer. Returns the code string; throws on any non-2xx (401 no session, 403
 * a viewer, 503 the binding store unwired). Parsed with `bindingResponseSchema` so shape drift fails loudly.
 * The durable proof is still the WhatsApp echo (`matchBinding` server-side) — this only issues the code.
 */
export async function requestBindingCode(): Promise<string> {
  const res = await fetch(`${API_BASE}/binding`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`POST /binding failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return bindingResponseSchema.parse(data).code;
}
