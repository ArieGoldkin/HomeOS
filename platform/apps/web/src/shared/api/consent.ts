import { type ConsentStatus, consentStatusSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * #270 — the session user's Terms/Privacy consent status from `GET /consent`. Session-gated (#225): the
 * Supabase session COOKIE rides the request (`credentials: "include"`), no bearer. `{ consented, version }`
 * — consented iff the user accepted the CURRENT terms version. Parsed with `consentStatusSchema` so shape
 * drift fails loudly here. Throws on non-2xx so the gate can decide (it fails OPEN on error — see ConsentGate).
 */
export async function fetchConsent(signal?: AbortSignal): Promise<ConsentStatus> {
  const res = await fetch(`${API_BASE}/consent`, { credentials: "include", signal });
  if (!res.ok) {
    throw new Error(`GET /consent failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return consentStatusSchema.parse(data);
}

/**
 * #270 — record the session user's acceptance of the current Terms/Privacy via `POST /consent`. Authorized
 * by the same session cookie. Idempotent server-side (upsert). Returns the now-consented status; throws on
 * any non-2xx so the mutation surfaces it.
 */
export async function acceptConsent(): Promise<ConsentStatus> {
  const res = await fetch(`${API_BASE}/consent`, { method: "POST", credentials: "include" });
  if (!res.ok) {
    throw new Error(`POST /consent failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return consentStatusSchema.parse(data);
}
