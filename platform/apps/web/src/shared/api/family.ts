import { type FamilyRosterResponse, familyRosterResponseSchema } from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * #235 — typed fetch of the family roster from `GET /family`. Like {@link fetchEvents}, the server is
 * session-gated (#225): we send the Supabase session COOKIE (`credentials: "include"`), no bearer. The
 * endpoint wraps the payload as `{ family, members }`, so we parse with `familyRosterResponseSchema` — any
 * shape drift fails loudly here, never silently in the roster UI. Names are Hebrew display strings.
 */
export async function fetchFamily(signal?: AbortSignal): Promise<FamilyRosterResponse> {
  const res = await fetch(`${API_BASE}/family`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    throw new Error(`GET /family failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return familyRosterResponseSchema.parse(data);
}
