import {
  type Invite,
  type InviteRequest,
  inviteResponseSchema,
  invitesResponseSchema,
} from "@homeos/shared";

const API_BASE = import.meta.env.VITE_HOMEOS_API_BASE ?? "";

/**
 * #250 — the owner's pending invites from `GET /invites`. Session-gated (#225) like the rest of the board:
 * the Supabase session COOKIE rides the request (`credentials: "include"`), no bearer. The server is ALSO
 * owner-gated — a non-owner gets 403 — which is what the web uses to gate the invite UI: this throws on the
 * 403 and the `useInvites` query lands in `error`, so the card stays hidden (capability-based gating). The
 * payload is wrapped `{ invites }`, parsed with `invitesResponseSchema` so shape drift fails loudly here.
 */
export async function fetchInvites(signal?: AbortSignal): Promise<Invite[]> {
  const res = await fetch(`${API_BASE}/invites`, { credentials: "include", signal });
  if (!res.ok) {
    throw new Error(`GET /invites failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return invitesResponseSchema.parse(data).invites;
}

/**
 * #250 — mint an owner-issued invite via `POST /invites` (owner-only, family-scoped server-side). Authorized
 * by the same session cookie. The body is the shared {@link InviteRequest} (email + role). Returns the single
 * minted invite, parsed with `inviteResponseSchema`. Throws on any non-2xx (400 a bad email, 403 not an owner).
 */
export async function createInvite(req: InviteRequest): Promise<Invite> {
  const res = await fetch(`${API_BASE}/invites`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`POST /invites failed (${res.status})`);
  }
  const data: unknown = await res.json();
  return inviteResponseSchema.parse(data).invite;
}

/**
 * #250 — owner-revoke a pending invite via `DELETE /invites/:id` (family-scoped server-side → a foreign id is
 * 404). Authorized by the session cookie. Resolves on 204; throws on any non-2xx so the mutation surfaces it.
 */
export async function revokeInvite(inviteId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/invites/${encodeURIComponent(inviteId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`DELETE /invites/${inviteId} failed (${res.status})`);
  }
}
